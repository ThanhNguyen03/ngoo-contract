// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title NgooPayment
 * @notice On-chain payment contract for the Ngoo food ordering platform.
 * @dev Accepts tBNB payments on BNB Testnet (chain ID 97) for food orders.
 *      Each payment is authorized by a server-side ECDSA signature that binds
 *      the order ID, payer address, exact amount, nonce, deadline, and chain ID.
 *      Uses OpenZeppelin for all security-critical primitives.
 */
contract NgooPayment is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @notice The server-side signer address whose signature authorizes payments
    address public signer;

    /// @notice Stores the record of a completed payment
    struct PaymentRecord {
        bytes32 orderId;
        address payer;
        uint256 amount;
        uint256 timestamp;
        bool exists;
    }

    /// @notice Maps orderId (keccak256 of UUID string) to its payment record
    mapping(bytes32 => PaymentRecord) public payments;

    /// @notice Tracks used nonces to prevent replay attacks
    mapping(bytes32 => bool) public usedNonces;

    // --- Events ---

    /// @notice Emitted when a payment is successfully received
    event PaymentReceived(bytes32 indexed orderId, address indexed payer, uint256 amount, uint256 timestamp);

    /// @notice Emitted when the owner withdraws funds
    event FundsWithdrawn(address indexed to, uint256 amount);

    /// @notice Emitted when the signer address is rotated
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);

    // --- Constructor ---

    /**
     * @notice Deploy the contract with an initial signer address
     * @param _signer The server-side wallet address that signs payment proofs
     */
    constructor(address _signer) Ownable(msg.sender) {
        require(_signer != address(0), "Signer cannot be zero address");
        signer = _signer;
    }

    // --- Payment ---

    /**
     * @notice Pay for an order using a server-issued proof
     * @dev The signature must be produced by the `signer` key over:
     *      keccak256(abi.encode(orderId, msg.sender, amount, nonce, deadline, block.chainid))
     *      wrapped in the EIP-191 prefix via MessageHashUtils.toEthSignedMessageHash.
     * @param orderId  keccak256 hash of the order UUID string
     * @param amount   Exact payment amount in wei (must match msg.value)
     * @param nonce    Random 32-byte value, single-use to prevent replay
     * @param deadline Unix timestamp after which the proof is invalid
     * @param signature 65-byte ECDSA signature from the server signer
     */
    function payOrder(
        bytes32 orderId,
        uint256 amount,
        bytes32 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external payable whenNotPaused nonReentrant {
        require(block.timestamp <= deadline, "Proof expired");
        require(!usedNonces[nonce], "Nonce already used");
        require(!payments[orderId].exists, "Order already paid");
        require(msg.value == amount, "Incorrect payment amount");

        bytes32 messageHash = keccak256(
            abi.encode(orderId, msg.sender, amount, nonce, deadline, block.chainid)
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);
        require(recovered == signer, "Invalid signature");

        usedNonces[nonce] = true;
        payments[orderId] = PaymentRecord({
            orderId: orderId,
            payer: msg.sender,
            amount: amount,
            timestamp: block.timestamp,
            exists: true
        });

        emit PaymentReceived(orderId, msg.sender, amount, block.timestamp);
    }

    // --- Admin ---

    /**
     * @notice Withdraw collected funds to a specified address
     * @dev Protected by ReentrancyGuard. Works even when paused for emergency recovery.
     * @param to     Destination address for the funds
     * @param amount Amount in wei to withdraw
     */
    function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Cannot withdraw to zero address");
        require(amount > 0, "Amount must be greater than zero");
        require(address(this).balance >= amount, "Insufficient balance");

        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");

        emit FundsWithdrawn(to, amount);
    }

    /**
     * @notice Rotate the signer address (e.g. for key rotation or incident response)
     * @param _newSigner New server-side signer wallet address
     */
    function setSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "Signer cannot be zero address");
        address oldSigner = signer;
        signer = _newSigner;
        emit SignerUpdated(oldSigner, _newSigner);
    }

    /**
     * @notice Pause the contract — disables payOrder (emergency stop)
     * @dev withdraw still works when paused for emergency fund recovery
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract — re-enables payOrder
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // --- Views ---

    /**
     * @notice Retrieve the payment record for a given orderId
     * @param orderId keccak256 hash of the order UUID string
     * @return PaymentRecord containing payer, amount, timestamp, and existence flag
     */
    function getPayment(bytes32 orderId) external view returns (PaymentRecord memory) {
        return payments[orderId];
    }

    // --- Fallback ---

    /**
     * @dev Reject direct BNB transfers to prevent accidental deposits.
     *      All payments must go through payOrder with a valid server signature.
     */
    receive() external payable {
        revert("Direct transfers not accepted");
    }
}
