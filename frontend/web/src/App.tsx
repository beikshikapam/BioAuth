import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface BioAuthData {
  id: string;
  name: string;
  biometricScore: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [bioAuthList, setBioAuthList] = useState<BioAuthData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAuth, setCreatingAuth] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAuthData, setNewAuthData] = useState({ name: "", biometricScore: "" });
  const [selectedAuth, setSelectedAuth] = useState<BioAuthData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, avgScore: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const authList: BioAuthData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          authList.push({
            id: businessId,
            name: businessData.name,
            biometricScore: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setBioAuthList(authList);
      updateStats(authList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: BioAuthData[]) => {
    const total = data.length;
    const verified = data.filter(item => item.isVerified).length;
    const avgScore = total > 0 ? data.reduce((sum, item) => sum + item.biometricScore, 0) / total : 0;
    
    setStats({ total, verified, avgScore });
  };

  const createAuth = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAuth(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating biometric auth with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const biometricValue = parseInt(newAuthData.biometricScore) || 0;
      const businessId = `bioauth-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, biometricValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuthData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        biometricValue,
        0,
        "Biometric Authentication Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Biometric auth created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewAuthData({ name: "", biometricScore: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAuth(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredAuthList = bioAuthList.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>BioAuthZama 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted biometric authentication system.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted biometric system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>BioAuthZama 🔐</h1>
          <p>Encrypted Biometric Authentication</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Biometric
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-item">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Records</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.avgScore.toFixed(1)}</div>
            <div className="stat-label">Avg Score</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search by name or creator..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="auth-list">
          {filteredAuthList.length === 0 ? (
            <div className="no-data">
              <p>No biometric records found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Record
              </button>
            </div>
          ) : (
            filteredAuthList.map((item, index) => (
              <div 
                key={index}
                className={`auth-item ${item.isVerified ? 'verified' : ''}`}
                onClick={() => setSelectedAuth(item)}
              >
                <div className="auth-header">
                  <h3>{item.name}</h3>
                  <span className={`status ${item.isVerified ? 'verified' : 'pending'}`}>
                    {item.isVerified ? '✅ Verified' : '🔓 Pending'}
                  </span>
                </div>
                <div className="auth-details">
                  <div>Score: {item.biometricScore}/100</div>
                  <div>Creator: {item.creator.substring(0, 8)}...</div>
                  <div>Date: {new Date(item.timestamp * 1000).toLocaleDateString()}</div>
                </div>
                {item.isVerified && item.decryptedValue && (
                  <div className="decrypted-value">
                    Decrypted: {item.decryptedValue}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Biometric Authentication</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE 🔐 Encryption</strong>
                <p>Biometric data will be encrypted with Zama FHE (Integer only)</p>
              </div>
              
              <div className="form-group">
                <label>Name *</label>
                <input 
                  type="text" 
                  value={newAuthData.name} 
                  onChange={(e) => setNewAuthData({...newAuthData, name: e.target.value})} 
                  placeholder="Enter name..." 
                />
              </div>
              
              <div className="form-group">
                <label>Biometric Score (0-100) *</label>
                <input 
                  type="number" 
                  min="0" 
                  max="100" 
                  value={newAuthData.biometricScore} 
                  onChange={(e) => setNewAuthData({...newAuthData, biometricScore: e.target.value})} 
                  placeholder="Enter biometric score..." 
                />
                <div className="data-label">FHE Encrypted Integer</div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createAuth} 
                disabled={creatingAuth || isEncrypting || !newAuthData.name || !newAuthData.biometricScore} 
                className="submit-btn"
              >
                {creatingAuth || isEncrypting ? "Encrypting..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedAuth && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Biometric Details</h2>
              <button onClick={() => setSelectedAuth(null)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-info">
                <div className="info-row">
                  <span>Name:</span>
                  <strong>{selectedAuth.name}</strong>
                </div>
                <div className="info-row">
                  <span>Creator:</span>
                  <strong>{selectedAuth.creator}</strong>
                </div>
                <div className="info-row">
                  <span>Date:</span>
                  <strong>{new Date(selectedAuth.timestamp * 1000).toLocaleString()}</strong>
                </div>
                <div className="info-row">
                  <span>Status:</span>
                  <strong className={selectedAuth.isVerified ? 'verified' : 'pending'}>
                    {selectedAuth.isVerified ? 'Verified' : 'Pending Verification'}
                  </strong>
                </div>
              </div>
              
              <div className="data-section">
                <h3>Encrypted Data</h3>
                <div className="encrypted-data">
                  {selectedAuth.isVerified ? (
                    <div className="verified-data">
                      <strong>Decrypted Value: {selectedAuth.decryptedValue}</strong>
                      <span className="badge verified">On-chain Verified</span>
                    </div>
                  ) : decryptedValue !== null ? (
                    <div className="local-data">
                      <strong>Decrypted Value: {decryptedValue}</strong>
                      <span className="badge local">Locally Decrypted</span>
                    </div>
                  ) : (
                    <div className="encrypted-status">
                      <span>🔒 FHE Encrypted</span>
                    </div>
                  )}
                </div>
                
                <button 
                  onClick={async () => {
                    const result = await decryptData(selectedAuth.id);
                    if (result !== null) setDecryptedValue(result);
                  }}
                  disabled={isDecrypting}
                  className="decrypt-btn"
                >
                  {isDecrypting ? "Decrypting..." : "Verify Decryption"}
                </button>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setSelectedAuth(null)} className="close-btn">Close</button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <div className="icon">✓</div>}
            {transactionStatus.status === "error" && <div className="icon">✗</div>}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;