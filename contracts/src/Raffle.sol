// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC721Min {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC20Min {
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Raffles each NFT that FloorVault buys to the holders of the coin that paid for it.
/// @dev Hackathon/testnet code, unaudited.
///
/// Round flow: `drawDelay` after opening, anyone calls `draw`, which fixes a seed from
/// `prevrandao` (demo-grade randomness, validators can bias it). For `settleWindow` after that,
/// anyone may submit a holder with `settle`; the contract checks the holder's current coin balance
/// and the lowest `hash(seed, holder) / balance` leads. Then `finalize` records the winner, who has
/// 7 days to `claim`. After that anyone may `reRaffle`, and past winners can no longer win. When a
/// round finishes with no valid holder, the NFT goes to the coin's recorded recipient.
contract Raffle {
    uint64 public constant CLAIM_WINDOW = 7 days;

    enum Stage {
        Waiting, // before draw: waiting for the draw time, then for someone to call `draw`
        Settling, // seed fixed: holders are being submitted
        Won, // winner recorded: waiting for the claim, or for the claim window to run out
        Claimed, // winner took the NFT
        Fallback // nobody was eligible, NFT went to the recorded recipient
    }

    struct RaffleInfo {
        address token; // the coin whose holders are eligible
        address collection;
        uint256 tokenId;
        address fallbackTo;
        Stage stage;
        uint32 round; // starts at 1, grows with every re-raffle
        uint64 drawAt; // earliest time `draw` works for the current round
        uint64 settleEnd; // end of the settle window, set by `draw`
        uint64 claimDeadline; // end of the claim window, set by `finalize`
        bytes32 seed;
        address leader;
        uint256 leaderScore;
        address winner;
    }

    uint64 public immutable drawDelay;
    uint64 public immutable settleWindow;

    address public immutable deployer;
    address public vault;
    uint256 public raffleCount;

    mapping(uint256 id => RaffleInfo) private _raffles;
    /// @notice True for winners who did not claim in time, per raffle.
    mapping(uint256 id => mapping(address holder => bool)) public excluded;
    /// @notice Addresses that hold coin supply without being real holders (bonding curve, DEX pair, ...).
    mapping(address => bool) public blocked;

    event Opened(
        uint256 indexed id,
        address indexed token,
        address indexed collection,
        uint256 tokenId,
        address fallbackTo,
        uint64 drawAt
    );
    event Drawn(uint256 indexed id, uint32 round, bytes32 seed, uint64 settleEnd);
    event Settled(uint256 indexed id, uint32 round, address indexed holder, uint256 score, bool leading);
    event Finalized(uint256 indexed id, uint32 round, address indexed winner, uint64 claimDeadline);
    event FellBack(uint256 indexed id, uint32 round, address indexed to);
    event Claimed(uint256 indexed id, address indexed winner);
    event ReRaffled(uint256 indexed id, uint32 round, uint64 drawAt, address indexed excludedWinner);

    constructor(uint64 drawDelay_, uint64 settleWindow_, address[] memory blocked_) {
        require(settleWindow_ > 0, "settle window is zero");
        drawDelay = drawDelay_;
        settleWindow = settleWindow_;
        deployer = msg.sender;
        for (uint256 i = 0; i < blocked_.length; i++) {
            blocked[blocked_[i]] = true;
        }
        blocked[address(0)] = true;
        blocked[address(0xdead)] = true;
        blocked[address(this)] = true;
    }

    /// @notice One-time wiring of the FloorVault that may open raffles. Only the deployer can call it.
    function init(address vault_) external {
        require(msg.sender == deployer, "not deployer");
        require(vault == address(0), "already initialised");
        require(vault_ != address(0), "zero address");
        vault = vault_;
        blocked[vault_] = true;
    }

    // ---- Views ---------------------------------------------------------------------------

    function getRaffle(uint256 id) external view returns (RaffleInfo memory) {
        return _raffles[id];
    }

    /// @notice Score for ordering candidates: lower wins. A bigger balance divides it down.
    function scoreOf(bytes32 seed, address holder, uint256 balance) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, holder))) / balance;
    }

    /// @notice Whether `holder` could be submitted right now, with the score they would get.
    function candidate(uint256 id, address holder) external view returns (bool ok, uint256 score, uint256 balance) {
        RaffleInfo storage r = _raffles[id];
        if (r.token == address(0) || r.stage != Stage.Settling) return (false, 0, 0);
        if (blocked[holder] || holder == r.token || excluded[id][holder]) return (false, 0, 0);
        balance = IERC20Min(r.token).balanceOf(holder);
        if (balance == 0) return (false, 0, 0);
        return (true, scoreOf(r.seed, holder, balance), balance);
    }

    // ---- Lifecycle -----------------------------------------------------------------------

    /// @notice Open a raffle for an NFT this contract already owns. Only the FloorVault may call it.
    function open(address token, address collection, uint256 tokenId, address fallbackTo)
        external
        returns (uint256 id)
    {
        require(msg.sender == vault && vault != address(0), "only vault");
        require(IERC721Min(collection).ownerOf(tokenId) == address(this), "raffle does not own the NFT");
        require(fallbackTo != address(0), "zero address");

        id = ++raffleCount;
        RaffleInfo storage r = _raffles[id];
        r.token = token;
        r.collection = collection;
        r.tokenId = tokenId;
        r.fallbackTo = fallbackTo;
        r.round = 1;
        r.drawAt = uint64(block.timestamp) + drawDelay;
        r.leaderScore = type(uint256).max;
        emit Opened(id, token, collection, tokenId, fallbackTo, r.drawAt);
    }

    /// @notice Fix the round's seed once the draw time has passed. Anyone may call.
    function draw(uint256 id) external {
        RaffleInfo storage r = _raffles[id];
        require(r.token != address(0), "unknown raffle");
        require(r.stage == Stage.Waiting, "already drawn");
        require(block.timestamp >= r.drawAt, "too early");

        r.seed = keccak256(abi.encode(block.prevrandao, id, r.round, block.number));
        r.settleEnd = uint64(block.timestamp) + settleWindow;
        r.stage = Stage.Settling;
        emit Drawn(id, r.round, r.seed, r.settleEnd);
    }

    /// @notice Submit a holder of the coin. Their current balance sets their score; the best score leads.
    function settle(uint256 id, address holder) external {
        RaffleInfo storage r = _raffles[id];
        require(r.stage == Stage.Settling, "not settling");
        require(block.timestamp < r.settleEnd, "settle window closed");
        require(!blocked[holder] && holder != r.token, "holder not eligible");
        require(!excluded[id][holder], "past winner");

        uint256 balance = IERC20Min(r.token).balanceOf(holder);
        require(balance > 0, "no balance");

        uint256 score = scoreOf(r.seed, holder, balance);
        bool leading = score < r.leaderScore;
        if (leading) {
            r.leaderScore = score;
            r.leader = holder;
        }
        emit Settled(id, r.round, holder, score, leading);
    }

    /// @notice Close the settle window. The leader wins, or the NFT goes to the recorded recipient.
    function finalize(uint256 id) external {
        RaffleInfo storage r = _raffles[id];
        require(r.stage == Stage.Settling, "not settling");
        require(block.timestamp >= r.settleEnd, "settle window open");

        if (r.leader == address(0)) {
            r.stage = Stage.Fallback;
            emit FellBack(id, r.round, r.fallbackTo);
            IERC721Min(r.collection).transferFrom(address(this), r.fallbackTo, r.tokenId);
            return;
        }
        r.winner = r.leader;
        r.claimDeadline = uint64(block.timestamp) + CLAIM_WINDOW;
        r.stage = Stage.Won;
        emit Finalized(id, r.round, r.winner, r.claimDeadline);
    }

    /// @notice The winner takes the NFT within the claim window.
    function claim(uint256 id) external {
        RaffleInfo storage r = _raffles[id];
        require(r.stage == Stage.Won, "nothing to claim");
        require(msg.sender == r.winner, "not the winner");
        require(block.timestamp <= r.claimDeadline, "claim window expired");

        r.stage = Stage.Claimed;
        emit Claimed(id, msg.sender);
        IERC721Min(r.collection).transferFrom(address(this), msg.sender, r.tokenId);
    }

    /// @notice After an unclaimed window runs out, start a fresh round. The old winner cannot win it.
    function reRaffle(uint256 id) external {
        RaffleInfo storage r = _raffles[id];
        require(r.stage == Stage.Won, "not re-raffleable");
        require(block.timestamp > r.claimDeadline, "claim window open");

        address previous = r.winner;
        excluded[id][previous] = true;
        r.round += 1;
        r.drawAt = uint64(block.timestamp) + drawDelay;
        r.settleEnd = 0;
        r.claimDeadline = 0;
        r.seed = bytes32(0);
        r.leader = address(0);
        r.leaderScore = type(uint256).max;
        r.winner = address(0);
        r.stage = Stage.Waiting;
        emit ReRaffled(id, r.round, r.drawAt, previous);
    }
}
