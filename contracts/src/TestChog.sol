// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-721 standing in for the CHOG collection on Monad testnet.
/// @dev TESTNET ONLY: `mint` is open to anyone. Not for production.
contract TestChog {
    string public constant name = "Test CHOG";
    string public constant symbol = "TCHOG";

    uint256 public totalSupply;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = ++totalSupply;
        ownerOf[tokenId] = to;
        balanceOf[to]++;
        emit Transfer(address(0), to, tokenId);
    }

    function approve(address spender, uint256 tokenId) external {
        address owner = ownerOf[tokenId];
        require(msg.sender == owner || isApprovedForAll[owner][msg.sender], "not authorized");
        getApproved[tokenId] = spender;
        emit Approval(owner, spender, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address owner = ownerOf[tokenId];
        require(from == owner, "wrong from");
        require(
            msg.sender == owner || getApproved[tokenId] == msg.sender || isApprovedForAll[owner][msg.sender],
            "not authorized"
        );
        delete getApproved[tokenId];
        balanceOf[from]--;
        balanceOf[to]++;
        ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd;
    }
}
