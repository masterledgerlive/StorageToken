// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {StoreToken} from "StoreToken.sol";

/// @title ShadowWeaveRouter
/// @notice LIBM hitch on a REAL leftover from OUR swap, OR a dedicated storage tx.
///         Never invents a swap. Hitch payload must fit leftover byte budget.
/// @dev Reconstructed from Origin spec (gamemasters/agent-genesis unreachable).
contract ShadowWeaveRouter {
    StoreToken public immutable storeToken;
    address public operator;

    /// @notice Credit cost: 1e15 wei STORE (0.001) per 32-byte word, min 1 word.
    uint256 public constant CREDITS_PER_WORD = 1e15;

    struct Leftover {
        address owner;
        uint256 leftoverBytes;
        bool used;
        bool exists;
    }

    struct Strand {
        address payer;
        bytes32 payloadHash;
        uint256 bytesLen;
        bytes32 leftoverTx;
        uint256 creditsPaid;
        bool dedicated;
    }

    mapping(bytes32 => Leftover) public leftovers;
    mapping(bytes32 => Strand) public strands;

    event LeftoverRegistered(bytes32 indexed swapTx, address indexed owner, uint256 leftoverBytes);
    event DedicatedStored(
        bytes32 indexed strandId,
        address indexed payer,
        uint256 bytesLen,
        uint256 creditsPaid,
        bytes32 payloadHash
    );
    event HitchStored(
        bytes32 indexed strandId,
        address indexed payer,
        bytes32 indexed leftoverTx,
        uint256 leftoverBytes,
        uint256 payloadLen,
        uint256 creditsPaid
    );

    error NotOperator();
    error ZeroHash();
    error EmptyPayload();
    error LeftoverUnknown();
    error LeftoverAlreadyUsed();
    error HitchExceedsLeftover();
    error NotLeftoverOwner();
    error InventedSwap();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(StoreToken _storeToken, address _operator) {
        require(address(_storeToken) != address(0) && _operator != address(0), "zero");
        storeToken = _storeToken;
        operator = _operator;
    }

    function setOperator(address next) external onlyOperator {
        require(next != address(0), "zero");
        operator = next;
    }

    /// @notice Register leftover calldata bytes from a REAL mined swap we sent.
    ///         Service must refuse to call this without a receipt hash.
    function registerLeftover(bytes32 swapTx, address owner_, uint256 leftoverBytes) external onlyOperator {
        if (swapTx == bytes32(0)) revert InventedSwap();
        leftovers[swapTx] = Leftover({
            owner: owner_,
            leftoverBytes: leftoverBytes,
            used: false,
            exists: true
        });
        emit LeftoverRegistered(swapTx, owner_, leftoverBytes);
    }

    function costForBytes(uint256 byteCount) public pure returns (uint256) {
        if (byteCount == 0) return 0;
        uint256 words = (byteCount + 31) / 32;
        return words * CREDITS_PER_WORD;
    }

    /// @notice Dedicated storage tx. Pays in $STORE credits (burn). Emits bytes-based mint.
    function storeDedicated(bytes calldata payload) external returns (bytes32 strandId) {
        if (payload.length == 0) revert EmptyPayload();
        bytes32 payloadHash = keccak256(payload);
        strandId = keccak256(abi.encodePacked(msg.sender, payloadHash, block.number, block.timestamp));
        uint256 cost = costForBytes(payload.length);
        storeToken.payForStorage(msg.sender, cost, strandId);
        storeToken.mintForBytes(payload.length);
        strands[strandId] = Strand({
            payer: msg.sender,
            payloadHash: payloadHash,
            bytesLen: payload.length,
            leftoverTx: bytes32(0),
            creditsPaid: cost,
            dedicated: true
        });
        emit DedicatedStored(strandId, msg.sender, payload.length, cost, payloadHash);
    }

    /// @notice Hitch payload into leftover calldata budget of a REAL registered swap.
    ///         hitch max = leftoverBytes. Never invents leftoverTx.
    function hitch(bytes calldata payload, bytes32 leftoverTx) external returns (bytes32 strandId) {
        if (payload.length == 0) revert EmptyPayload();
        if (leftoverTx == bytes32(0)) revert InventedSwap();
        Leftover storage lo = leftovers[leftoverTx];
        if (!lo.exists) revert LeftoverUnknown();
        if (lo.used) revert LeftoverAlreadyUsed();
        if (lo.owner != msg.sender) revert NotLeftoverOwner();
        if (payload.length > lo.leftoverBytes) revert HitchExceedsLeftover();

        bytes32 payloadHash = keccak256(payload);
        strandId = keccak256(abi.encodePacked(msg.sender, leftoverTx, payloadHash, block.number));
        uint256 cost = costForBytes(payload.length);
        storeToken.payForStorage(msg.sender, cost, strandId);
        storeToken.mintForBytes(payload.length);
        lo.used = true;
        strands[strandId] = Strand({
            payer: msg.sender,
            payloadHash: payloadHash,
            bytesLen: payload.length,
            leftoverTx: leftoverTx,
            creditsPaid: cost,
            dedicated: false
        });
        emit HitchStored(strandId, msg.sender, leftoverTx, lo.leftoverBytes, payload.length, cost);
    }
}
