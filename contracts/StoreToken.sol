// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title StoreToken ($STORE)
/// @notice ERC-20 storage credits. Mint is router-only. Emission is bytes-based.
///         $STORE credits are the only payment for storage inject.
///         JWT / strand tokens are READ access, never money.
/// @dev Reconstructed from Origin gamemasters/agent-genesis spec
///      (repo 404 / cloud agent bc-e37bda11 not reachable). No Origin clone.
contract StoreToken {
    string public constant name = "StorageToken";
    string public constant symbol = "STORE";
    uint8 public constant decimals = 18;

    /// @notice Credits minted per stored byte (1e12 = 0.000001 STORE).
    uint256 public constant EMISSION_PER_BYTE = 1e12;

    address public owner;
    address public router;
    address public emissionSink;
    bool public seedingEnabled;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event RouterUpdated(address indexed router);
    event EmissionSinkUpdated(address indexed sink);
    event Seeded(address indexed to, uint256 amount);
    event StoragePaid(address indexed payer, uint256 amount, bytes32 indexed strandId);
    event BytesEmitted(address indexed sink, uint256 byteCount, uint256 minted);

    error NotOwner();
    error NotRouter();
    error ZeroAddress();
    error SeedingDisabled();
    error InsufficientBalance();
    error InsufficientAllowance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    constructor(address _owner, address _emissionSink, bool _seedingEnabled) {
        if (_owner == address(0) || _emissionSink == address(0)) revert ZeroAddress();
        owner = _owner;
        emissionSink = _emissionSink;
        seedingEnabled = _seedingEnabled;
    }

    function setRouter(address _router) external onlyOwner {
        if (_router == address(0)) revert ZeroAddress();
        router = _router;
        emit RouterUpdated(_router);
    }

    function setEmissionSink(address _sink) external onlyOwner {
        if (_sink == address(0)) revert ZeroAddress();
        emissionSink = _sink;
        emit EmissionSinkUpdated(_sink);
    }

    function setSeedingEnabled(bool enabled) external onlyOwner {
        seedingEnabled = enabled;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        owner = next;
    }

    /// @notice Testnet faucet. Disable before any mainnet deploy.
    function seedCredits(address to, uint256 amount) external onlyOwner {
        if (!seedingEnabled) revert SeedingDisabled();
        if (to == address(0)) revert ZeroAddress();
        _mint(to, amount);
        emit Seeded(to, amount);
    }

    /// @notice Router-only mint: bytes-based emission to the sink (not the payer).
    function mintForBytes(uint256 byteCount) external onlyRouter returns (uint256 minted) {
        minted = byteCount * EMISSION_PER_BYTE;
        if (minted == 0) return 0;
        _mint(emissionSink, minted);
        emit BytesEmitted(emissionSink, byteCount, minted);
    }

    /// @notice Burn $STORE credits as the only storage payment. No silent skim.
    function payForStorage(address payer, uint256 amount, bytes32 strandId) external onlyRouter {
        if (amount == 0) return;
        if (balanceOf[payer] < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[payer] -= amount;
            totalSupply -= amount;
        }
        emit Transfer(payer, address(0), amount);
        emit StoragePaid(payer, amount, strandId);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
