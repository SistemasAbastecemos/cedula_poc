import React, { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes, faBolt } from "@fortawesome/free-solid-svg-icons"; // Importamos rayo para flash
import styles from "./styles.module.css";
import { APELLIDOS_COLOMBIANOS } from "../utils/apellidos_colombianos";
import { faBolt } from "@fortawesome/free-solid-svg-icons"; // <--- AGREGA ESTO EN LOS IMPORTS


// (LA LÓGICA DE PARSEAR SE MANTIENE IGUAL, LA OMITO PARA AHORRAR ESPACIO PERO DEBES DEJARLA)
// ... PEGA AQUÍ LA FUNCIÓN parsearDatosEscaneados DEL MENSAJE ANTERIOR ...
const parsearDatosEscaneados = (rawData) => {
  if (!rawData || rawData.length < 5) return null;

  // 1. LIMPIEZA INICIAL
  let cleanData = "";
  for (let i = 0; i < rawData.length; i++) {
    const charCode = rawData.charCodeAt(i);
    // Dejar pasar solo lo útil: Letras, Números, Ñ, Espacios
    if ((charCode >= 48 && charCode <= 57) || 
        (charCode >= 65 && charCode <= 90) || 
        (charCode >= 97 && charCode <= 122) || 
        charCode === 209 || charCode === 241 || 
        charCode === 32) { 
      cleanData += rawData[i];
    } else {
      cleanData += " ";
    }
  }
  const dataNormalizada = cleanData.replace(/\s+/g, " ").trim();
  
  // CASO 1: CÉDULA DIGITAL
  if (dataNormalizada.includes("PubDSK") || rawData.includes("PubDSK")) {
     try {
        const indexAnchor = cleanData.indexOf("PubDSK");
        let tramaUtil = cleanData.substring(indexAnchor + 6);
        const matchInicio = tramaUtil.match(/.*?(\d{15,25})/);
        if (matchInicio) {
            tramaUtil = tramaUtil.substring(tramaUtil.indexOf(matchInicio[1]));
            const regexDigital = /^(\d+)([A-ZÑ]+)(?:0|\s|1)?([MF])(\d{8})/;
            const match = tramaUtil.match(regexDigital);
            if (match) {
                const cedula = parseInt(match[1].slice(-10), 10).toString();
                const nombresPegados = match[2];
                let apellidos = "";
                let nombres = "";
                let resto = nombresPegados;
                let foundAp1 = false;
                
                for (const ap of APELLIDOS_COLOMBIANOS) {
                    if (resto.startsWith(ap)) { apellidos += ap; resto = resto.substring(ap.length); foundAp1 = true; break; }
                }
                if (foundAp1) {
                    for (const ap of APELLIDOS_COLOMBIANOS) {
                        if (resto.startsWith(ap)) { apellidos += " " + ap; resto = resto.substring(ap.length); break; }
                    }
                    nombres = resto;
                } else { apellidos = nombresPegados; nombres = ""; }
                return { tipo: "CEDULA_DIGITAL", cedula, apellidos: apellidos.trim(), nombres: nombres.trim() };
            }
        }
     } catch (e) {}
  }

  // CASO 2: CÉDULA ANTIGUA
  const regexSandwich = /(\d{7,15})\s*([A-ZÑ\s]+?)\s*0([MF])(\d{8})/;
  const match = dataNormalizada.match(regexSandwich);

  if (match) {
    try {
      let cedulaRaw = match[1];
      if (cedulaRaw.length > 10) cedulaRaw = cedulaRaw.slice(-10);
      const cedula = parseInt(cedulaRaw, 10).toString();
      const textoNombres = match[2].trim(); 
      const partesNombre = textoNombres.split(" ").filter(Boolean);
      let apellidos = "";
      let nombres = "";
      if (partesNombre.length >= 3) {
        apellidos = `${partesNombre[0]} ${partesNombre[1]}`;
        nombres = partesNombre.slice(2).join(" ");
      } else if (partesNombre.length === 2) {
        apellidos = partesNombre[0];
        nombres = partesNombre[1];
      } else {
        apellidos = textoNombres;
      }
      return { tipo: "CEDULA_ANTIGUA", cedula, apellidos: apellidos.trim(), nombres: nombres.trim() };
    } catch (e) {}
  }
  return null;
};


// ============================================================================
// COMPONENTE MEJORADO
// ============================================================================
const ScannerModal = ({ isOpen, onClose, onScan }) => {
  const scannerRef = useRef(null);
  const physicalInputRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const [error, setError] = useState("");
  // const [scanner, setScanner] = useState(null); // Ya no usamos el estado simple, usamos ref directo
  const codeReaderRef = useRef(null); // Ref para la instancia del lector

  const [isMobile, setIsMobile] = useState(false);
  const [activeMode, setActiveMode] = useState("camera"); // Por defecto cámara
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  
  // Estados para Flash/Linterna
  const [videoTrack, setVideoTrack] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);

  const bufferRef = useRef("");
  const timeoutRef = useRef(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // --- LÓGICA DE LIMPIEZA ---
  const limpiarBuffer = useCallback((data) => {
    if (!data) return "";
    return data
      .replace(/<F\d+>/gi, "")
      .replace(/<CR>|<LF>|<GS>|<RS>|<US>/gi, "")
      .split("")
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return (code >= 32 && code <= 126) || code === 209 || code === 241;
      })
      .join("");
  }, []);

  // --- MANEJO DE CÁMARA MEJORADO (PDF417 + 1080p + Flash) ---
  const handleCameraScan = useCallback(
    (text) => {
      // Filtro de ruido: ignorar lecturas muy cortas
      if (text.length < 8) return;

      const dataLimpia = limpiarBuffer(text);
      const resultado = parsearDatosEscaneados(dataLimpia);
      
      if (resultado) {
        onScan(resultado);
        onClose();
      } else {
        // Opcional: Si lee algo pero no parsea, podrías intentar mandarlo como simple
        // onScan({ tipo: "CODIGO_SIMPLE", codigo: dataLimpia });
        // onClose();
        console.log("Lectura detectada, esperando mejor frame...");
      }
    },
    [limpiarBuffer, onScan, onClose]
  );

  const toggleTorch = async () => {
    if (videoTrack && hasTorch) {
      try {
        await videoTrack.applyConstraints({
          advanced: [{ torch: !torchOn }]
        });
        setTorchOn(!torchOn);
      } catch (err) {
        console.error("Error cambiando flash:", err);
      }
    }
  };

  const initScanner = useCallback(async () => {
    if (!scannerRef.current) return;
    
    try {
      // 1. CONFIGURACIÓN "HARDCORE" PARA PDF417
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.PDF_417, // Prioridad absoluta Cédula Col
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true); // Gastar más CPU para leer mejor

      const codeReader = new BrowserMultiFormatReader(hints);
      codeReaderRef.current = codeReader;

      const videoElement = document.createElement("video");
      videoElement.style.width = "100%";
      videoElement.style.height = "100%";
      videoElement.style.objectFit = "cover";

      scannerRef.current.innerHTML = "";
      scannerRef.current.appendChild(videoElement);

      // 2. SOLICITAR ALTA RESOLUCIÓN (Clave para PDF417)
      const constraints = {
        video: { 
          facingMode: "environment", // Cámara trasera
          width: { ideal: 1920 },    // Full HD
          height: { ideal: 1080 },
          focusMode: "continuous"    // Autoenfoque continuo
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // 3. DETECTAR LINTERNA
      const track = stream.getVideoTracks()[0];
      setVideoTrack(track);
      
      // Chequear si soporta antorcha
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (capabilities.torch) {
        setHasTorch(true);
      }

      videoElement.srcObject = stream;
      videoElement.setAttribute("playsinline", "true"); // Importante iOS
      await videoElement.play();

      codeReader.decodeFromStream(stream, videoElement, (result) => {
        if (result) {
          handleCameraScan(result.getText());
        }
      });

    } catch (err) {
      console.error("Error inicializando scanner:", err);
      setError("No se pudo acceder a la cámara o no es segura (HTTPS).");
    }
  }, [handleCameraScan]);

  const stopScanner = useCallback(() => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    if (videoTrack) {
      videoTrack.stop();
      setVideoTrack(null);
    }
  }, [videoTrack]);

  // --- EFECTOS ---
  useEffect(() => {
    if (isOpen && activeMode === "camera") {
      setError("");
      const timer = setTimeout(initScanner, 300);
      return () => {
        clearTimeout(timer);
        stopScanner();
      };
    } else {
      stopScanner();
    }
  }, [isOpen, activeMode, initScanner, stopScanner]);

  // (Lógica de escáner físico y upload se mantiene igual...)
  // ... (Copiar lógica de handleFileUpload y handleKeyDown del código anterior si la necesitas) ...

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={`${styles.modalContent} ${isMobile ? styles.mobileModal : ''}`}>
        
        {/* HEADER FLOTANTE */}
        <div className={styles.modalHeader}>
          <h2>Escanear Código</h2>
          <button 
            type="button" 
            onClick={onClose} 
            className={styles.closeButton}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {/* CONTENIDO PRINCIPAL */}
        <div className={styles.scannerContainer} style={{flex: 1, position: 'relative'}}>
          {error ? (
            <div className={styles.scannerError} style={{color: 'white', textAlign: 'center', marginTop: '50%'}}>
              <p>{error}</p>
              <button
                type="button"
                onClick={() => { setError(""); if (activeMode === "camera") initScanner(); }}
                className={styles.retryButton}
              >
                Reintentar
              </button>
            </div>
          ) : (
            <>
              {activeMode === "camera" && (
                <>
                  <div ref={scannerRef} className={styles.qrReader} />
                  
                  {/* OVERLAY TIPO CÉDULA */}
                  <div className={styles.scannerOverlay}>
                    <div className={styles.scanLine}></div>
                  </div>
                  
                  <p className={styles.scannerHint}>
                    Gira el celular y encaja el código de barras en el recuadro
                  </p>

                  {/* BOTÓN FLASH */}
                  {hasTorch && (
                    <button 
                      className={`${styles.torchButton} ${torchOn ? styles.torchButtonActive : ''}`}
                      onClick={toggleTorch}
                    >
                      <FontAwesomeIcon icon={faBolt} />
                    </button>
                  )}
                </>
              )}

              {activeMode === "physical" && (
                 /* ... Tu código de escáner físico anterior ... */
                 <div style={{color: 'white', textAlign: 'center', paddingTop: '100px'}}>
                    <FontAwesomeIcon icon={faBarcode} size="3x" />
                    <p>Modo Escáner USB Activo</p>
                 </div>
              )}

              {activeMode === "upload" && (
                 /* ... Tu código de upload anterior ... */
                 <div style={{color: 'white', textAlign: 'center', paddingTop: '100px'}}>
                   <p>Funcionalidad de subida (implementar UI aquí)</p>
                 </div>
              )}
            </>
          )}
        </div>

        {/* TABS INFERIORES */}
        <div className={styles.scannerTabs}>
          <button
            className={`${styles.scannerTab} ${activeMode === "camera" ? styles.activeTab : ""}`}
            onClick={() => setActiveMode("camera")}
          >
            <FontAwesomeIcon icon={faCamera} /> Cámara
          </button>
          <button
            className={`${styles.scannerTab} ${activeMode === "physical" ? styles.activeTab : ""}`}
            onClick={() => setActiveMode("physical")}
          >
            <FontAwesomeIcon icon={faBarcode} /> Físico
          </button>
          <button
            className={`${styles.scannerTab} ${activeMode === "upload" ? styles.activeTab : ""}`}
            onClick={() => setActiveMode("upload")}
          >
            <FontAwesomeIcon icon={faUpload} /> Archivo
          </button>
        </div>
      </div>
    </div>
  );
};
///e
export default ScannerModal;