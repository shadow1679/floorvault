// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestChog} from "../src/TestChog.sol";
import {MockMarketplace} from "../src/MockMarketplace.sol";
import {IMarketplace} from "../src/IMarketplace.sol";
import {Raffle} from "../src/Raffle.sol";
import {FloorVault, INadRouter, INadCreatorFeeVault, IWMON, IRaffle} from "../src/FloorVault.sol";

contract MockCoin {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

/// @dev The test contract plays the vault: it buys from MockMarketplace straight into the raffle,
/// then opens it, exactly as FloorVault.buy does.
contract RaffleTest is Test {
    uint64 constant DRAW_DELAY = 1 hours;
    uint64 constant SETTLE_WINDOW = 10 minutes;

    TestChog chog;
    MockMarketplace market;
    Raffle raffle;
    MockCoin coin;

    address seller = makeAddr("seller");
    address fallbackTo = makeAddr("nftRecipient");
    address curve = makeAddr("bondingCurve");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 id;
    uint256 openedAt;

    receive() external payable {}

    function setUp() public {
        vm.warp(1_000_000);
        chog = new TestChog();
        market = new MockMarketplace();
        address[] memory blocked = new address[](1);
        blocked[0] = curve;
        raffle = new Raffle(DRAW_DELAY, SETTLE_WINDOW, blocked);
        raffle.init(address(this));
        coin = new MockCoin();

        coin.mint(curve, 800_000 ether);
        coin.mint(alice, 100 ether);
        coin.mint(bob, 50 ether);
        coin.mint(carol, 1 ether);

        vm.startPrank(seller);
        chog.setApprovalForAll(address(market), true);
        market.list(address(chog), chog.mint(seller), 1 ether); // token 1
        vm.stopPrank();

        id = _buyAndOpen();
        openedAt = block.timestamp;
    }

    function _buyAndOpen() internal returns (uint256) {
        (uint256 tokenId,) = market.buyFloor{value: 1 ether}(address(chog), 1 ether, address(raffle));
        return raffle.open(address(coin), address(chog), tokenId, fallbackTo);
    }

    function _listAnother() internal {
        vm.startPrank(seller);
        market.list(address(chog), chog.mint(seller), 1 ether);
        vm.stopPrank();
    }

    function _draw() internal {
        vm.warp(block.timestamp + DRAW_DELAY);
        raffle.draw(id);
    }

    function _finalizeAfterSettle() internal {
        vm.warp(block.timestamp + SETTLE_WINDOW);
        raffle.finalize(id);
    }

    function _info() internal view returns (Raffle.RaffleInfo memory) {
        return raffle.getRaffle(id);
    }

    // ---- Open ------------------------------------------------------------------------------

    function test_openRecordsRaffleOwnedByRaffle() public view {
        Raffle.RaffleInfo memory r = _info();
        assertEq(chog.ownerOf(1), address(raffle));
        assertEq(r.token, address(coin));
        assertEq(r.collection, address(chog));
        assertEq(r.tokenId, 1);
        assertEq(r.fallbackTo, fallbackTo);
        assertEq(r.round, 1);
        assertEq(r.drawAt, openedAt + DRAW_DELAY);
        assertEq(uint8(r.stage), uint8(Raffle.Stage.Waiting));
        assertEq(raffle.raffleCount(), 1);
    }

    function test_openOnlyByVault() public {
        vm.prank(alice);
        vm.expectRevert("only vault");
        raffle.open(address(coin), address(chog), 1, fallbackTo);
    }

    function test_openRequiresRaffleToOwnTheNft() public {
        vm.prank(seller);
        uint256 other = chog.mint(seller);
        vm.expectRevert("raffle does not own the NFT");
        raffle.open(address(coin), address(chog), other, fallbackTo);
    }

    function test_initOnceAndOnlyDeployer() public {
        address[] memory none = new address[](0);
        Raffle fresh = new Raffle(1, 1, none);
        vm.prank(alice);
        vm.expectRevert("not deployer");
        fresh.init(alice);
        fresh.init(alice);
        vm.expectRevert("already initialised");
        fresh.init(bob);
    }

    // ---- Draw ------------------------------------------------------------------------------

    function test_drawTooEarlyReverts() public {
        vm.warp(openedAt + DRAW_DELAY - 1);
        vm.expectRevert("too early");
        raffle.draw(id);
    }

    function test_drawFixesSeedAndOpensSettleWindow() public {
        vm.warp(openedAt + DRAW_DELAY);
        vm.prevrandao(bytes32(uint256(123)));
        raffle.draw(id);
        Raffle.RaffleInfo memory r = _info();
        assertEq(uint8(r.stage), uint8(Raffle.Stage.Settling));
        assertTrue(r.seed != bytes32(0));
        assertEq(r.settleEnd, block.timestamp + SETTLE_WINDOW);
    }

    function test_drawTwiceReverts() public {
        _draw();
        vm.expectRevert("already drawn");
        raffle.draw(id);
    }

    // ---- Settle ----------------------------------------------------------------------------

    function test_settleBestScoreLeads() public {
        _draw();
        bytes32 seed = _info().seed;
        raffle.settle(id, alice);
        raffle.settle(id, bob);
        raffle.settle(id, carol);

        uint256 sa = raffle.scoreOf(seed, alice, 100 ether);
        uint256 sb = raffle.scoreOf(seed, bob, 50 ether);
        uint256 sc = raffle.scoreOf(seed, carol, 1 ether);
        address expected = alice;
        uint256 best = sa;
        if (sb < best) (expected, best) = (bob, sb);
        if (sc < best) (expected, best) = (carol, sc);

        Raffle.RaffleInfo memory r = _info();
        assertEq(r.leader, expected);
        assertEq(r.leaderScore, best);
    }

    function test_settleWorseScoreDoesNotReplaceLeader() public {
        _draw();
        bytes32 seed = _info().seed;
        raffle.settle(id, alice);
        raffle.settle(id, bob);
        address leader = raffle.getRaffle(id).leader;
        // Resubmitting the leader or the other holder never changes the outcome.
        raffle.settle(id, alice);
        raffle.settle(id, bob);
        assertEq(raffle.getRaffle(id).leader, leader);
        assertEq(
            raffle.getRaffle(id).leaderScore,
            raffle.scoreOf(seed, leader, coin.balanceOf(leader))
        );
    }

    function test_settleBiggerBalanceMeansLowerScore() public view {
        // Same hash, ten times the balance: a tenth of the score.
        bytes32 seed = bytes32(uint256(7));
        assertEq(raffle.scoreOf(seed, alice, 10), raffle.scoreOf(seed, alice, 1) / 10);
    }

    function test_settleRevertsForZeroBalance() public {
        _draw();
        vm.expectRevert("no balance");
        raffle.settle(id, makeAddr("nobody"));
    }

    function test_settleRevertsForBlockedAddresses() public {
        _draw();
        vm.expectRevert("holder not eligible");
        raffle.settle(id, curve);
        vm.expectRevert("holder not eligible");
        raffle.settle(id, address(coin));
        vm.expectRevert("holder not eligible");
        raffle.settle(id, address(raffle));
        vm.expectRevert("holder not eligible");
        raffle.settle(id, address(this)); // the vault
    }

    function test_settleRevertsAfterWindowCloses() public {
        _draw();
        vm.warp(block.timestamp + SETTLE_WINDOW);
        vm.expectRevert("settle window closed");
        raffle.settle(id, alice);
    }

    function test_settleBeforeDrawReverts() public {
        vm.expectRevert("not settling");
        raffle.settle(id, alice);
    }

    function test_candidateViewMatchesSettle() public {
        _draw();
        (bool ok, uint256 score, uint256 balance) = raffle.candidate(id, alice);
        assertTrue(ok);
        assertEq(balance, 100 ether);
        assertEq(score, raffle.scoreOf(_info().seed, alice, 100 ether));
        (ok,,) = raffle.candidate(id, curve);
        assertFalse(ok);
        (ok,,) = raffle.candidate(id, makeAddr("nobody"));
        assertFalse(ok);
    }

    // ---- Finalize and claim ----------------------------------------------------------------

    function test_finalizeWhileWindowOpenReverts() public {
        _draw();
        raffle.settle(id, alice);
        vm.expectRevert("settle window open");
        raffle.finalize(id);
    }

    function test_finalizeRecordsWinnerAndStartsClaimWindow() public {
        _draw();
        raffle.settle(id, alice);
        _finalizeAfterSettle();
        Raffle.RaffleInfo memory r = _info();
        assertEq(uint8(r.stage), uint8(Raffle.Stage.Won));
        assertEq(r.winner, alice);
        assertEq(r.claimDeadline, block.timestamp + 7 days);
        assertEq(chog.ownerOf(1), address(raffle), "still escrowed until claimed");
    }

    function test_winnerClaimsWithinSevenDays() public {
        _draw();
        raffle.settle(id, alice);
        _finalizeAfterSettle();
        vm.warp(block.timestamp + 7 days); // the last second still counts
        vm.prank(alice);
        raffle.claim(id);
        assertEq(chog.ownerOf(1), alice);
        assertEq(uint8(_info().stage), uint8(Raffle.Stage.Claimed));
    }

    function test_onlyWinnerCanClaim() public {
        _draw();
        raffle.settle(id, alice);
        _finalizeAfterSettle();
        vm.prank(bob);
        vm.expectRevert("not the winner");
        raffle.claim(id);
    }

    function test_claimAfterExpiryReverts() public {
        _draw();
        raffle.settle(id, alice);
        _finalizeAfterSettle();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        vm.expectRevert("claim window expired");
        raffle.claim(id);
    }

    function test_claimTwiceReverts() public {
        _draw();
        raffle.settle(id, alice);
        _finalizeAfterSettle();
        vm.startPrank(alice);
        raffle.claim(id);
        vm.expectRevert("nothing to claim");
        raffle.claim(id);
        vm.stopPrank();
    }

    // ---- Re-raffle -------------------------------------------------------------------------

    function test_reRaffleBeforeExpiryReverts() public {
        _draw();
        raffle.settle(id, alice);
        _finalizeAfterSettle();
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert("claim window open");
        raffle.reRaffle(id);
    }

    function test_reRaffleAfterClaimReverts() public {
        _draw();
        raffle.settle(id, alice);
        _finalizeAfterSettle();
        vm.prank(alice);
        raffle.claim(id);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("not re-raffleable");
        raffle.reRaffle(id);
    }

    function test_reRaffleBeforeWinnerRecordedReverts() public {
        vm.expectRevert("not re-raffleable");
        raffle.reRaffle(id);
    }

    function test_reRaffleStartsNewRoundAndExcludesOldWinner() public {
        _draw();
        bytes32 seed1 = _info().seed;
        raffle.settle(id, alice);
        _finalizeAfterSettle();
        vm.warp(block.timestamp + 7 days + 1);
        raffle.reRaffle(id);

        Raffle.RaffleInfo memory r = _info();
        assertEq(uint8(r.stage), uint8(Raffle.Stage.Waiting));
        assertEq(r.round, 2);
        assertEq(r.drawAt, block.timestamp + DRAW_DELAY);
        assertEq(r.winner, address(0));
        assertEq(r.leader, address(0));
        assertTrue(raffle.excluded(id, alice));

        // The new round needs its own draw delay and its own seed.
        vm.expectRevert("too early");
        raffle.draw(id);
        vm.warp(block.timestamp + DRAW_DELAY);
        vm.prevrandao(bytes32(uint256(999)));
        raffle.draw(id);
        assertTrue(_info().seed != seed1);

        vm.expectRevert("past winner");
        raffle.settle(id, alice);
        raffle.settle(id, bob);
        _finalizeAfterSettle();
        assertEq(_info().winner, bob);
    }

    function test_secondWinnerAlsoExcludedAfterAnotherExpiry() public {
        _draw();
        raffle.settle(id, alice);
        _finalizeAfterSettle();
        vm.warp(block.timestamp + 7 days + 1);
        raffle.reRaffle(id);
        _draw();
        raffle.settle(id, bob);
        _finalizeAfterSettle();
        vm.warp(block.timestamp + 7 days + 1);
        raffle.reRaffle(id);
        assertTrue(raffle.excluded(id, alice));
        assertTrue(raffle.excluded(id, bob));
        assertEq(_info().round, 3);
    }

    // ---- No holders ------------------------------------------------------------------------

    function test_noValidHolderSendsNftToRecipient() public {
        _draw();
        _finalizeAfterSettle();
        assertEq(chog.ownerOf(1), fallbackTo);
        assertEq(uint8(_info().stage), uint8(Raffle.Stage.Fallback));
    }

    function test_reRaffleWithOnlyPastWinnerFallsBack() public {
        MockCoin solo = new MockCoin();
        solo.mint(alice, 1 ether);
        _listAnother();
        (uint256 tokenId,) = market.buyFloor{value: 1 ether}(address(chog), 1 ether, address(raffle));
        uint256 id2 = raffle.open(address(solo), address(chog), tokenId, fallbackTo);

        vm.warp(block.timestamp + DRAW_DELAY);
        raffle.draw(id2);
        raffle.settle(id2, alice);
        vm.warp(block.timestamp + SETTLE_WINDOW);
        raffle.finalize(id2);
        vm.warp(block.timestamp + 7 days + 1);
        raffle.reRaffle(id2);
        vm.warp(block.timestamp + DRAW_DELAY);
        raffle.draw(id2);
        vm.warp(block.timestamp + SETTLE_WINDOW);
        raffle.finalize(id2);
        assertEq(chog.ownerOf(tokenId), fallbackTo);
    }

    // ---- Scoping ---------------------------------------------------------------------------

    function test_raffleIsScopedToItsOwnCoin() public {
        MockCoin other = new MockCoin();
        other.mint(carol, 5 ether);
        _listAnother();
        (uint256 tokenId,) = market.buyFloor{value: 1 ether}(address(chog), 1 ether, address(raffle));
        uint256 id2 = raffle.open(address(other), address(chog), tokenId, fallbackTo);
        assertEq(id2, 2);

        vm.warp(block.timestamp + DRAW_DELAY);
        raffle.draw(id2);
        // alice holds `coin`, not `other`.
        vm.expectRevert("no balance");
        raffle.settle(id2, alice);
        raffle.settle(id2, carol);
    }
}

// ---- Offline FloorVault.buy -> Raffle integration, with stand-ins for nad.fun ------------------

contract MockWMON {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    receive() external payable {}
}

contract MockRouter {
    function createWithNative(INadRouter.CreateParams calldata) external payable returns (address token, uint256) {
        token = address(new MockCoin());
    }
}

contract MockFeeVault {
    MockWMON immutable wmon;

    constructor(MockWMON wmon_) {
        wmon = wmon_;
    }

    function claim(address) external {
        wmon.mint(msg.sender, 10 ether);
    }
}

/// @dev Mainnet behaviour: the Creator Fee vault unwraps and pays native MON to the claimer.
contract MockNativeFeeVault {
    function claim(address) external {
        (bool ok,) = msg.sender.call{value: 10 ether}("");
        require(ok, "pay failed");
    }

    receive() external payable {}
}

contract FloorVaultRaffleTest is Test {
    TestChog chog;
    MockMarketplace market;
    MockWMON wmon;
    Raffle raffle;
    FloorVault vault;
    address token;

    address seller = makeAddr("seller");
    address nftRecipient = makeAddr("nftRecipient");
    address treasury = makeAddr("treasury");
    address keeper = makeAddr("keeper");

    function setUp() public {
        vm.warp(1_000_000);
        chog = new TestChog();
        market = new MockMarketplace();
        wmon = new MockWMON();
        vm.deal(address(wmon), 100 ether); // backs withdraw()

        address[] memory none = new address[](0);
        raffle = new Raffle(1 hours, 10 minutes, none);
        vault = new FloorVault(
            INadRouter(address(new MockRouter())),
            INadCreatorFeeVault(address(new MockFeeVault(wmon))),
            IWMON(address(wmon)),
            IMarketplace(address(market)),
            IRaffle(address(raffle)),
            treasury,
            keeper,
            address(chog)
        );
        raffle.init(address(vault));

        vm.startPrank(seller);
        chog.setApprovalForAll(address(market), true);
        market.list(address(chog), chog.mint(seller), 3 ether);
        vm.stopPrank();

        token = vault.launch(
            FloorVault.LaunchArgs({
                name: "Coin",
                symbol: "C",
                tokenURI: "",
                creatorFeeRate: 100,
                salt: bytes32(0),
                deadline: block.timestamp + 1 hours,
                collection: address(chog),
                nftRecipient: nftRecipient,
                devBuy: 0
            })
        );
    }

    function _budgetOf() internal view returns (uint256 budget) {
        (,, budget) = vault.pairings(token);
    }

    function test_buyHandsNftToRaffleAndOpensIt() public {
        vault.harvest(token); // 10 MON claimed: 8 to budget
        vm.prank(keeper);
        (uint256 tokenId, uint256 price) = vault.buy(token, 3 ether, "");

        assertEq(price, 3 ether);
        assertEq(chog.ownerOf(tokenId), address(raffle), "raffle owns the NFT");
        assertEq(chog.ownerOf(tokenId) == nftRecipient, false);
        assertEq(raffle.raffleCount(), 1);
        Raffle.RaffleInfo memory r = raffle.getRaffle(1);
        assertEq(r.token, token);
        assertEq(r.collection, address(chog));
        assertEq(r.tokenId, tokenId);
        assertEq(r.fallbackTo, nftRecipient);
        assertEq(uint8(r.stage), uint8(Raffle.Stage.Waiting));

        // With nobody holding the coin, the NFT ends up with the recorded recipient.
        vm.warp(block.timestamp + 1 hours);
        raffle.draw(1);
        vm.warp(block.timestamp + 10 minutes);
        raffle.finalize(1);
        assertEq(chog.ownerOf(tokenId), nftRecipient);
    }

    function test_buyChargesActualPriceAndRewrapsUnspent() public {
        vault.harvest(token);
        uint256 budgetBefore = _budgetOf(); // 8 MON
        uint256 wmonBefore = wmon.balanceOf(address(vault));

        vm.prank(keeper);
        (, uint256 price) = vault.buy(token, 5 ether, ""); // floor is 3: 2 comes back

        assertEq(price, 3 ether, "charged the real price, not maxPrice");
        assertEq(_budgetOf(), budgetBefore - 3 ether);
        assertEq(wmon.balanceOf(address(vault)), wmonBefore - 3 ether, "unspent MON is wrapped back");
        assertEq(address(vault).balance, 0, "vault keeps no native");
    }

    function test_buyRevertsForNonKeeper() public {
        vault.harvest(token);
        vm.expectRevert("not keeper");
        vault.buy(token, 3 ether, "");
    }

    function test_buyRevertsAboveBudget() public {
        vm.prank(keeper);
        vm.expectRevert("above budget");
        vault.buy(token, 1 ether, ""); // budget is 0 before any harvest
    }

    function test_buyRevertsWhenListingCostsMoreThanMaxPrice() public {
        vault.harvest(token);
        vm.prank(keeper);
        vm.expectRevert("floor above max price");
        vault.buy(token, 2 ether, ""); // floor is 3
    }

    function test_launchOnlyAllowedCollection() public {
        TestChog other = new TestChog();
        vm.expectRevert("collection not supported");
        vault.launch(
            FloorVault.LaunchArgs({
                name: "Coin",
                symbol: "C",
                tokenURI: "",
                creatorFeeRate: 100,
                salt: bytes32(uint256(1)),
                deadline: block.timestamp + 1 hours,
                collection: address(other),
                nftRecipient: nftRecipient,
                devBuy: 0
            })
        );
    }

    function test_onlyTreasuryRotatesKeeper() public {
        vm.expectRevert("not treasury");
        vault.setKeeper(address(this));
        vm.prank(treasury);
        vault.setKeeper(address(this));
        assertEq(vault.keeper(), address(this));
    }

    function test_harvestWrapsNativeFeesPaidByMainnetStyleVault() public {
        MockNativeFeeVault nativeVault = new MockNativeFeeVault();
        vm.deal(address(nativeVault), 10 ether);
        FloorVault v = new FloorVault(
            INadRouter(address(new MockRouter())),
            INadCreatorFeeVault(address(nativeVault)),
            IWMON(address(wmon)),
            IMarketplace(address(market)),
            IRaffle(address(raffle)),
            treasury,
            keeper,
            address(chog)
        );
        address t = v.launch(
            FloorVault.LaunchArgs({
                name: "Coin",
                symbol: "C",
                tokenURI: "",
                creatorFeeRate: 100,
                salt: bytes32(uint256(2)),
                deadline: block.timestamp + 1 hours,
                collection: address(chog),
                nftRecipient: nftRecipient,
                devBuy: 0
            })
        );

        uint256 claimed = v.harvest(t);

        assertEq(claimed, 10 ether, "native claim is counted");
        assertEq(wmon.balanceOf(treasury), 1 ether, "10% to treasury in WMON");
        assertEq(wmon.balanceOf(v.creators(t)), 1 ether, "10% to creator in WMON");
        (,, uint256 budget) = v.pairings(t);
        assertEq(budget, 8 ether);
        assertEq(address(v).balance, 0, "no native stranded in the vault");
        assertEq(wmon.balanceOf(address(v)), 8 ether, "budget is backed by WMON");
    }
}
