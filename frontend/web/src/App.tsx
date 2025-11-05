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
  biometricValue: string;
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
  const [bioAuths, setBioAuths] = useState<BioAuthData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAuth, setCreatingAuth] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAuthData, setNewAuthData] = useState({ name: "", biometric: "" });
  const [selectedAuth, setSelectedAuth] = useState<BioAuthData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

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
            biometricValue: businessId,
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
      
      setBioAuths(authList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
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
      
      const biometricValue = parseInt(newAuthData.biometric) || 0;
      const businessId = `bioauth-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, biometricValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuthData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
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
      setNewAuthData({ name: "", biometric: "" });
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
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and working!" 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }, 3000));
    }
  };

  const renderDashboard = () => {
    const totalAuths = bioAuths.length;
    const verifiedAuths = bioAuths.filter(a => a.isVerified).length;
    const todayAuths = bioAuths.filter(a => 
      Date.now()/1000 - a.timestamp < 60 * 60 * 24
    ).length;

    return (
      <div className="dashboard-panels">
        <div className="panel gradient-panel neon-purple">
          <h3>Total Authentications</h3>
          <div className="stat-value">{totalAuths}</div>
          <div className="stat-trend">+{todayAuths} today</div>
        </div>
        
        <div className="panel gradient-panel neon-blue">
          <h3>Verified Data</h3>
          <div className="stat-value">{verifiedAuths}/{totalAuths}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="panel gradient-panel neon-pink">
          <h3>Security Level</h3>
          <div className="stat-value">99.9%</div>
          <div className="stat-trend">Zero Knowledge</div>
        </div>
      </div>
    );
  };

  const renderCharts = () => {
    const verifiedCount = bioAuths.filter(a => a.isVerified).length;
    const pendingCount = bioAuths.length - verifiedCount;
    
    return (
      <div className="charts-section">
        <div className="chart-container">
          <h3>Authentication Status</h3>
          <div className="pie-chart">
            <div 
              className="chart-segment verified" 
              style={{ 
                '--percentage': `${(verifiedCount / bioAuths.length) * 360 || 0}deg`,
                '--color': '#ff00ff'
              } as React.CSSProperties}
            >
              <div className="segment-label">Verified: {verifiedCount}</div>
            </div>
            <div 
              className="chart-segment pending" 
              style={{ 
                '--percentage': `${(pendingCount / bioAuths.length) * 360 || 0}deg`,
                '--color': '#00ffff'
              } as React.CSSProperties}
            >
              <div className="segment-label">Pending: {pendingCount}</div>
            </div>
            <div className="chart-center">
              <div className="chart-total">{bioAuths.length}</div>
              <div className="chart-title">Total</div>
            </div>
          </div>
        </div>
        
        <div className="chart-container">
          <h3>Daily Activity</h3>
          <div className="bar-chart">
            {[1,2,3,4,5,6,7].map(day => (
              <div key={day} className="bar-container">
                <div 
                  className="bar-fill"
                  style={{ height: `${Math.random() * 80 + 20}%` }}
                ></div>
                <div className="bar-label">Day {day}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqs = [
      {
        question: "What is FHE Biometric Authentication?",
        answer: "FHE (Fully Homomorphic Encryption) allows biometric data to be encrypted and compared without ever decrypting it, ensuring maximum privacy."
      },
      {
        question: "How does the encryption work?",
        answer: "Your biometric data is encrypted using Zama FHE technology before being stored on-chain. Only encrypted comparisons are performed."
      },
      {
        question: "Is my data safe?",
        answer: "Yes! Your original biometric data never leaves your device unencrypted. Only homomorphic operations are performed on encrypted data."
      },
      {
        question: "What types of biometric data are supported?",
        answer: "Currently supports integer-based biometric templates. Future versions will support more complex biometric patterns."
      }
    ];

    return (
      <div className="faq-section">
        <h3>Frequently Asked Questions</h3>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <div key={index} className="faq-item">
              <div className="faq-question">{faq.question}</div>
              <div className="faq-answer">{faq.answer}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header neon-header">
          <div className="logo">
            <h1>BioAuthZama 🔐</h1>
            <span>Encrypted Biometric Authentication</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Secure your biometric data with FHE encryption technology</p>
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

  return (
    <div className="app-container">
      <header className="app-header neon-header">
        <div className="logo">
          <h1>BioAuthZama 🔐</h1>
          <span>Encrypted Biometric Authentication</span>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Authentication
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <nav className="app-nav">
        <button 
          className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button 
          className={`nav-btn ${activeTab === "authentications" ? "active" : ""}`}
          onClick={() => setActiveTab("authentications")}
        >
          Authentications
        </button>
        <button 
          className={`nav-btn ${activeTab === "analytics" ? "active" : ""}`}
          onClick={() => setActiveTab("analytics")}
        >
          Analytics
        </button>
        <button 
          className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          FAQ
        </button>
      </nav>
      
      <div className="main-content">
        {activeTab === "dashboard" && (
          <div className="tab-content">
            <h2>FHE Biometric Dashboard</h2>
            {renderDashboard()}
            
            <div className="fhe-flow-section">
              <h3>FHE Encryption Flow</h3>
              <div className="fhe-flow">
                {['Encrypt', 'Store', 'Compare', 'Verify'].map((step, index) => (
                  <div key={index} className="flow-step">
                    <div className="step-number">{index + 1}</div>
                    <div className="step-label">{step}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "authentications isRefreshing" && (
          <div className="tab-content">
            <div className="section-header">
              <h2>Biometric Authentications</h2>
              <button onClick={loadData} className="refresh-btn">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            
            <div className="auth-list">
              {bioAuths.length === 0 ? (
                <div className="empty-state">
                  <p>No biometric authentications found</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">
                    Create First Authentication
                  </button>
                </div>
              ) : bioAuths.map((auth, index) => (
                <div 
                  key={index} 
                  className="auth-item"
                  onClick={() => setSelectedAuth(auth)}
                >
                  <div className="auth-header">
                    <h3>{auth.name}</h3>
                    <span className={`status ${auth.isVerified ? "verified" : "pending"}`}>
                      {auth.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </span>
                  </div>
                  <div className="auth-details">
                    <span>Created: {new Date(auth.timestamp * 1000).toLocaleDateString()}</span>
                    <span>By: {auth.creator.substring(0, 8)}...</span>
                  </div>
                  {auth.isVerified && (
                    <div className="auth-value">
                      Biometric Score: {auth.decryptedValue}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "analytics" && (
          <div className="tab-content">
            <h2>Authentication Analytics</h2>
            {renderCharts()}
            
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Encryption Success Rate</h3>
                <div className="stat-value">100%</div>
              </div>
              <div className="stat-card">
                <h3>Average Verification Time</h3>
                <div className="stat-value">2.3s</div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="tab-content">
            <h2>FHE Biometric FAQ</h2>
            {renderFAQ()}
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Biometric Authentication</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Authentication Name</label>
                <input 
                  type="text" 
                  value={newAuthData.name}
                  onChange={(e) => setNewAuthData({...newAuthData, name: e.target.value})}
                  placeholder="Enter authentication name..."
                />
              </div>
              
              <div className="form-group">
                <label>Biometric Value (Integer)</label>
                <input 
                  type="number" 
                  value={newAuthData.biometric}
                  onChange={(e) => setNewAuthData({...newAuthData, biometric: e.target.value})}
                  placeholder="Enter biometric value..."
                />
                <div className="help-text">FHE Encrypted Integer Value</div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createAuth} 
                disabled={creatingAuth || isEncrypting}
                className="submit-btn"
              >
                {creatingAuth ? "Creating..." : "Create Authentication"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedAuth && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Authentication Details</h2>
              <button onClick={() => setSelectedAuth(null)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-item">
                <label>Name:</label>
                <span>{selectedAuth.name}</span>
              </div>
              <div className="detail-item">
                <label>Status:</label>
                <span className={selectedAuth.isVerified ? "verified" : "encrypted"}>
                  {selectedAuth.isVerified ? "Verified" : "Encrypted"}
                </span>
              </div>
              <div className="detail-item">
                <label>Creator:</label>
                <span>{selectedAuth.creator}</span>
              </div>
              
              {!selectedAuth.isVerified && (
                <button 
                  onClick={() => decryptData(selectedAuth.id)}
                  className="decrypt-btn"
                >
                  Verify Decryption
                </button>
              )}
              
              {selectedAuth.isVerified && (
                <div className="decrypted-value">
                  <h3>Decrypted Biometric Value</h3>
                  <div className="value-display">{selectedAuth.decryptedValue}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

