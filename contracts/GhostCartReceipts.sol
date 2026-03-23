// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract GhostCartReceipts {
    struct Receipt {
        uint256 id;
        uint256 agentId;
        address operator;
        address payer;
        uint256 amount;
        uint64 timestamp;
        bytes32 paymentRefHash;
        bytes32 itemHash;
        bytes32 metadataHash;
        string provider;
        string merchant;
        string currency;
    }

    address public owner;
    mapping(address => bool) public writers;
    uint256 public nextReceiptId = 1;
    mapping(uint256 => Receipt) public receipts;
    mapping(bytes32 => uint256) public receiptIdByPaymentRefHash;

    event WriterUpdated(address indexed writer, bool allowed);
    event ReceiptRecorded(
        uint256 indexed receiptId,
        uint256 indexed agentId,
        address indexed payer,
        string provider,
        string merchant,
        string currency,
        uint256 amount,
        bytes32 paymentRefHash,
        bytes32 itemHash,
        bytes32 metadataHash
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyWriter() {
        require(writers[msg.sender], "not writer");
        _;
    }

    constructor(address initialWriter) {
        owner = msg.sender;
        writers[msg.sender] = true;
        emit WriterUpdated(msg.sender, true);

        if (initialWriter != address(0) && initialWriter != msg.sender) {
            writers[initialWriter] = true;
            emit WriterUpdated(initialWriter, true);
        }
    }

    function setWriter(address writer, bool allowed) external onlyOwner {
        writers[writer] = allowed;
        emit WriterUpdated(writer, allowed);
    }

    function recordReceipt(
        uint256 agentId,
        address payer,
        uint256 amount,
        string calldata provider,
        string calldata merchant,
        string calldata currency,
        bytes32 paymentRefHash,
        bytes32 itemHash,
        bytes32 metadataHash
    ) external onlyWriter returns (uint256 receiptId) {
        uint256 existingReceiptId = receiptIdByPaymentRefHash[paymentRefHash];
        if (existingReceiptId != 0) {
            return existingReceiptId;
        }

        receiptId = nextReceiptId++;
        receipts[receiptId] = Receipt({
            id: receiptId,
            agentId: agentId,
            operator: msg.sender,
            payer: payer,
            amount: amount,
            timestamp: uint64(block.timestamp),
            paymentRefHash: paymentRefHash,
            itemHash: itemHash,
            metadataHash: metadataHash,
            provider: provider,
            merchant: merchant,
            currency: currency
        });
        receiptIdByPaymentRefHash[paymentRefHash] = receiptId;

        emit ReceiptRecorded(
            receiptId,
            agentId,
            payer,
            provider,
            merchant,
            currency,
            amount,
            paymentRefHash,
            itemHash,
            metadataHash
        );
    }
}
