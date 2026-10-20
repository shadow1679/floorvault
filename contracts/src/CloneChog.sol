// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Testnet stand-in for Chog Genesis that serves the real collection's metadata and art.
/// @dev TESTNET ONLY: `mint` is open to anyone. Each token carries the exact `tokenURI` of a mainnet Chog Genesis
/// token (an `ipfs://` link to its JSON, which in turn links the image), so it renders the same pictures and
/// traits without re-hosting anything. Same ERC-721 surface as `TestChog`, plus `tokenURI` and ERC-2981 royalties.
contract CloneChog {
    string public constant name = "Chog Genesis (Testnet)";
    string public constant symbol = "tCHOG";

    /// Royalty terms copied from mainnet Chog Genesis: 5% to the same receiver.
    address public constant ROYALTY_RECEIVER = 0x84113421A8a564b594ee9Ae78c875310332d7023;
    uint256 public constant ROYALTY_BPS = 500;

    uint256 public totalSupply;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(uint256 => string) private _tokenURIs;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(ownerOf[tokenId] != address(0), "nonexistent token");
        return _tokenURIs[tokenId];
    }

    function royaltyInfo(uint256, uint256 salePrice) external pure returns (address, uint256) {
        return (ROYALTY_RECEIVER, (salePrice * ROYALTY_BPS) / 10_000);
    }

    function mint(address to, string calldata uri) external returns (uint256 tokenId) {
        tokenId = _mint(to, uri);
    }

    function mintBatch(address to, string[] calldata uris) external returns (uint256 firstId) {
        firstId = totalSupply + 1;
        for (uint256 i = 0; i < uris.length; i++) {
            _mint(to, uris[i]);
        }
    }

    function _mint(address to, string calldata uri) internal returns (uint256 tokenId) {
        tokenId = ++totalSupply;
        ownerOf[tokenId] = to;
        balanceOf[to]++;
        _tokenURIs[tokenId] = uri;
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

    /// ERC-165: ERC-721, ERC-721 Metadata and ERC-2981.
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f || id == 0x2a55205a;
    }
}
