pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedBiometricAuth is ZamaEthereumConfig {
    struct BiometricData {
        address owner;
        euint32 encryptedTemplate;
        uint256 creationTimestamp;
        bool isVerified;
        uint32 decryptedValue;
    }

    mapping(bytes32 => BiometricData) public biometricRegistry;
    mapping(address => bytes32[]) public userBiometrics;

    event BiometricRegistered(bytes32 indexed biometricId, address indexed owner);
    event VerificationCompleted(bytes32 indexed biometricId, uint32 decryptedValue);

    constructor() ZamaEthereumConfig() {}

    function registerBiometric(
        externalEuint32 encryptedTemplate,
        bytes calldata registrationProof
    ) external returns (bytes32 biometricId) {
        biometricId = keccak256(abi.encodePacked(msg.sender, block.timestamp));

        require(!biometricRegistry[biometricId].isVerified, "Biometric ID already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedTemplate, registrationProof)), "Invalid encrypted template");

        biometricRegistry[biometricId] = BiometricData({
            owner: msg.sender,
            encryptedTemplate: FHE.fromExternal(encryptedTemplate, registrationProof),
            creationTimestamp: block.timestamp,
            isVerified: false,
            decryptedValue: 0
        });

        FHE.allowThis(biometricRegistry[biometricId].encryptedTemplate);
        FHE.makePubliclyDecryptable(biometricRegistry[biometricId].encryptedTemplate);

        userBiometrics[msg.sender].push(biometricId);

        emit BiometricRegistered(biometricId, msg.sender);

        return biometricId;
    }

    function verifyBiometric(
        bytes32 biometricId,
        bytes memory abiEncodedClearValue,
        bytes memory verificationProof
    ) external {
        require(biometricRegistry[biometricId].owner != address(0), "Biometric not registered");
        require(!biometricRegistry[biometricId].isVerified, "Biometric already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(biometricRegistry[biometricId].encryptedTemplate);

        FHE.checkSignatures(cts, abiEncodedClearValue, verificationProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        biometricRegistry[biometricId].decryptedValue = decodedValue;
        biometricRegistry[biometricId].isVerified = true;

        emit VerificationCompleted(biometricId, decodedValue);
    }

    function getBiometric(bytes32 biometricId) external view returns (
        address owner,
        uint256 creationTimestamp,
        bool isVerified,
        uint32 decryptedValue
    ) {
        require(biometricRegistry[biometricId].owner != address(0), "Biometric not found");

        BiometricData storage data = biometricRegistry[biometricId];
        return (
            data.owner,
            data.creationTimestamp,
            data.isVerified,
            data.decryptedValue
        );
    }

    function getUserBiometrics(address user) external view returns (bytes32[] memory) {
        return userBiometrics[user];
    }

    function getEncryptedTemplate(bytes32 biometricId) external view returns (euint32) {
        require(biometricRegistry[biometricId].owner != address(0), "Biometric not found");
        return biometricRegistry[biometricId].encryptedTemplate;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

