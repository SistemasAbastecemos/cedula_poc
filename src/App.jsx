import React, { useState } from "react";
import ScannerModal from "./components/ScannerModal";
import styles from "./components/styles.module.css";

function App() {
  const [showScanner, setShowScanner] = useState(false);
  const [formData, setFormData] = useState({
    cedula: "",
    nombres: "",
    apellidos: "",
    tipo: ""
  });

  const handleScan = (data) => {
    setFormData({
      cedula: data.cedula || "",
      nombres: data.nombres || "",
      apellidos: data.apellidos || "",
      tipo: data.tipo || "UNKNOWN"
    });
  };

  return (
    <div className={styles.formContainer}>
      <h1>Prueba Scanner Cédula 1</h1>
      
      <button 
        className={styles.scanBtn}
        onClick={() => setShowScanner(true)}
      >
        Escanear Cédula (Cámara)
      </button>

      <div className={styles.inputGroup}>
        <label>Tipo Detectado:</label>
        <input type="text" value={formData.tipo} readOnly />
      </div>

      <div className={styles.inputGroup}>
        <label>Cédula:</label>
        <input type="text" value={formData.cedula} readOnly />
      </div>

      <div className={styles.inputGroup}>
        <label>Nombres:</label>
        <input type="text" value={formData.nombres} readOnly />
      </div>

      <div className={styles.inputGroup}>
        <label>Apellidos:</label>
        <input type="text" value={formData.apellidos} readOnly />
      </div>

      <ScannerModal 
        isOpen={showScanner} 
        onClose={() => setShowScanner(false)} 
        onScan={handleScan} 
      />
    </div>
  );
}

export default App;