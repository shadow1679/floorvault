// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMarketplace} from "./IMarketplace.sol";

interface IWMON {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function withdraw(uint256 amount) external;
    function deposit() external payable;
}

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IRaffle {
    function open(address token, address collection, uint256 tokenId, address fallbackTo)
        external
        returns (uint256 id);
}

interface INadCreatorFeeVault {
    function claim(address token) external;
}

interface INadRouter {
    struct VaultAllocation {
        address vault;
        uint16 bps;
        bytes setupData;
    }

    struct CreateParams {
        string name;
        string symbol;
        string tokenURI;
        address quoteToken;
        uint16 creatorFeeRate;
        VaultAllocation[] vaults;
        bytes32 salt;
        uint8 dexType;
        uint256 buyQuoteAmount;
        uint256 deadline;
    }

    function createWithNative(CreateParams calldata params) external payable returns (address token, uint256 amountOut);
}

/// @notice Launches nad.fun coins whose creator fee is routed here, then spends it on NFTs.
/// Of each claimed fee, 10% goes to the treasury, 10% to the coin's creator and 80% becomes a per-coin NFT budget that
/// can only buy the paired collection, at or below the budget. Each bought NFT goes to the Raffle
/// contract, which raffles it to the coin's holders; with no valid holder it reaches the recorded recipient.
/// @dev Hackathon code, unaudited. Anyone may call harvest: destinations are fixed at launch. `buy` is
/// restricted to the keeper because the keeper picks the listing and its price off-chain (Seaport has no
/// on-chain floor); otherwise anyone could list a token of the collection at exactly the budget and buy it.
/// The keeper still cannot redirect funds or buy outside the paired collection and budget, but it is
/// trusted to choose a fair listing. `allowedCollection` limits launches to one collection (0 = any).
contract FloorVault {
    uint256 public constant BPS = 10_000;
    uint256 public constant TREASURY_BPS = 1_000;
    uint256 public constant CREATOR_BPS = 1_000;

    INadRouter public immutable router;
    INadCreatorFeeVault public immutable creatorFeeVault;
    IWMON public immutable wmon;
    IMarketplace public immutable market;
    IRaffle public immutable raffle;
    address public immutable treasury;
    address public immutable allowedCollection;
    /// @notice Only caller of `buy`. Zero means anyone (testnet with the mock marketplace only).
    address public keeper;

    struct Pairing {
        address collection;
        address nftRecipient;
        uint256 budget; // WMON available for buying, in wei
    }

    mapping(address token => Pairing) public pairings;
    /// @notice Who launched each coin; receives CREATOR_BPS of every harvest.
    mapping(address token => address) public creators;

    uint256 private _lock = 1;

    event Launched(address indexed token, address indexed creator, address indexed collection, address nftRecipient);
    event Harvested(address indexed token, uint256 claimed, uint256 toTreasury, uint256 toCreator, uint256 toBudget);
    event Bought(address indexed token, address indexed collection, uint256 tokenId, uint256 price, address to);
    event KeeperChanged(address indexed keeper);

    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(
        INadRouter router_,
        INadCreatorFeeVault creatorFeeVault_,
        IWMON wmon_,
        IMarketplace market_,
        IRaffle raffle_,
        address treasury_,
        address keeper_,
        address allowedCollection_
    ) {
        router = router_;
        creatorFeeVault = creatorFeeVault_;
        wmon = wmon_;
        market = market_;
        raffle = raffle_;
        treasury = treasury_;
        keeper = keeper_;
        allowedCollection = allowedCollection_;
        emit KeeperChanged(keeper_);
    }

    /// @notice The treasury can rotate the keeper (set to zero only with a marketplace that is safe for anyone to call).
    function setKeeper(address keeper_) external {
        require(msg.sender == treasury, "not treasury");
        keeper = keeper_;
        emit KeeperChanged(keeper_);
    }

    struct LaunchArgs {
        string name;
        string symbol;
        string tokenURI;
        uint16 creatorFeeRate;
        bytes32 salt;
        uint256 deadline;
        address collection;
        address nftRecipient;
        uint256 devBuy; // MON the creator spends buying the coin in the same transaction (0 = none)
    }

    /// @notice Launch a coin on nad.fun paired with `a.collection`. msg.value covers nad.fun's
    /// create fee plus `a.devBuy`; anything the router does not use is refunded to the caller. The coins
    /// bought with `devBuy` are forwarded to the caller.
    function launch(LaunchArgs calldata a) external payable nonReentrant returns (address token) {
        require(a.collection != address(0) && a.nftRecipient != address(0), "zero address");
        require(allowedCollection == address(0) || a.collection == allowedCollection, "collection not supported");

        INadRouter.VaultAllocation[] memory vaults = new INadRouter.VaultAllocation[](1);
        vaults[0] = INadRouter.VaultAllocation(address(creatorFeeVault), uint16(BPS), abi.encode(address(this)));

        uint256 balanceBefore = address(this).balance - msg.value;
        (token,) = router.createWithNative{value: msg.value}(
            INadRouter.CreateParams({
                name: a.name,
                symbol: a.symbol,
                tokenURI: a.tokenURI,
                quoteToken: address(wmon),
                creatorFeeRate: a.creatorFeeRate,
                vaults: vaults,
                salt: a.salt,
                dexType: 0,
                buyQuoteAmount: a.devBuy,
                deadline: a.deadline
            })
        );

        // The router delivers the dev buy to its caller, which is this contract: hand it on to the creator.
        // The token is brand new, so its whole balance here is the dev buy.
        uint256 bought = IERC20Min(token).balanceOf(address(this));
        if (bought > 0) require(IERC20Min(token).transfer(msg.sender, bought), "dev buy transfer failed");

        require(pairings[token].collection == address(0), "already paired");
        pairings[token] = Pairing({collection: a.collection, nftRecipient: a.nftRecipient, budget: 0});
        creators[token] = msg.sender;
        emit Launched(token, msg.sender, a.collection, a.nftRecipient);

        uint256 refund = address(this).balance - balanceBefore;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok, "refund failed");
        }
    }

    /// @notice Pull accrued creator fees for `token` from nad.fun and split them 10% treasury / 10% creator / 80% budget.
    function harvest(address token) public nonReentrant returns (uint256 claimed) {
        Pairing storage p = pairings[token];
        require(p.collection != address(0), "unknown token");

        // The testnet Creator Fee vault pays WMON; the mainnet one unwraps and pays native MON straight to
        // `receive()`. Handle both: wrap whatever native arrives so the budget stays in WMON.
        uint256 wmonBefore = wmon.balanceOf(address(this));
        uint256 nativeBefore = address(this).balance;
        _claimFees(token);
        uint256 nativeIn = address(this).balance - nativeBefore;
        if (nativeIn > 0) wmon.deposit{value: nativeIn}();
        claimed = wmon.balanceOf(address(this)) - wmonBefore;

        uint256 toTreasury = (claimed * TREASURY_BPS) / BPS;
        uint256 toCreator = (claimed * CREATOR_BPS) / BPS;
        uint256 toBudget = claimed - toTreasury - toCreator;
        p.budget += toBudget;
        if (toTreasury > 0) require(wmon.transfer(treasury, toTreasury), "treasury transfer failed");
        if (toCreator > 0) require(wmon.transfer(creators[token], toCreator), "creator transfer failed");
        emit Harvested(token, claimed, toTreasury, toCreator, toBudget);
    }

    /// @notice Buy one listing of the paired collection for at most `maxPrice`, which must fit in the coin's
    /// budget. `data` is passed to the marketplace (a signed Seaport order on mainnet). The NFT is sent to
    /// the Raffle contract, and the raffle for this coin opens in the same transaction. The price charged
    /// to the budget is what the marketplace actually kept of `maxPrice`, measured by balance; the rest is
    /// wrapped back into WMON.
    function buy(address token, uint256 maxPrice, bytes calldata data)
        external
        nonReentrant
        returns (uint256 tokenId, uint256 price)
    {
        require(keeper == address(0) || msg.sender == keeper, "not keeper");
        Pairing storage p = pairings[token];
        require(p.collection != address(0), "unknown token");
        require(maxPrice <= p.budget, "above budget");

        uint256 balanceBefore = address(this).balance;
        wmon.withdraw(maxPrice);
        (tokenId,) = market.buyListing{value: maxPrice}(p.collection, maxPrice, address(raffle), data);

        uint256 unspent = address(this).balance - balanceBefore;
        require(unspent <= maxPrice, "unexpected native inflow");
        price = maxPrice - unspent;
        if (unspent > 0) wmon.deposit{value: unspent}();
        p.budget -= price;

        // MockMarketplace moves the NFT with a plain transferFrom, so no receiver hook fires: open explicitly.
        raffle.open(token, p.collection, tokenId, p.nftRecipient);
        emit Bought(token, p.collection, tokenId, price, address(raffle));
    }

    /// @dev Pulls `token`'s fees from nad.fun's Creator Fee vault. Virtual only so the testnet demo vault can
    /// add a pre-funded pot, because nad.fun settles real fees after about 100 MON; nothing else overrides it.
    function _claimFees(address token) internal virtual {
        creatorFeeVault.claim(token);
    }

    receive() external payable {}
}
