import React, { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import styles from "./styles.module.css";
import { APELLIDOS_COLOMBIANOS } from "../utils/apellidos_colombianos";

// ============================================================================
// LÓGICA DE PARSEO (CÉDULAS COLOMBIANAS)
// ============================================================================
const parsearDatosEscaneados = (rawData) => {
  if (!rawData || rawData.length < 5) return null;

  console.log("=== INICIANDO PARSEO ===");
  
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
  console.log("Data Normalizada:", dataNormalizada);
  
  // CASO 1: CÉDULA DIGITAL (PubDSK)
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
                // const genero = match[3];
                // const f = match[4];
                
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
     } catch (e) { console.error("Error Digital:", e); }
  }

  // CASO 2: CÉDULA ANTIGUA (Estrategia Sándwich)
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
    } catch (e) { console.error("Error procesando antigua:", e); }
  }
  return null;
};

// ============================================================================
// COMPONENTE VISUAL
// ============================================================================
const ScannerModal = ({ isOpen, onClose, onScan }) => {
  const scannerRef = useRef(null);
  const [scanner, setScanner] = useState(null);
  const [error, setError] = useState("");

  // Handler cuando la cámara detecta algo
  const handleCameraScan = useCallback((text) => {
      // Limpieza básica de caracteres de control antes de enviar al parser
      const cleanText = text.replace(/<F\d+>/gi, "").replace(/<CR>|<LF>|<GS>|<RS>|<US>/gi, "");
      const resultado = parsearDatosEscaneados(cleanText);
      
      if (resultado) {
        onScan(resultado);
        onClose(); // Cerrar modal al tener éxito
      } else {
        console.log("Lectura detectada pero falló el parseo:", cleanText);
      }
    }, [onScan, onClose]);

  // Inicializador de la cámara
  const initScanner = useCallback(() => {
    if (!scannerRef.current) return;
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.PDF_417, // CRÍTICO: Formato de cédula colombiana
        BarcodeFormat.CODE_128,
        BarcodeFormat.QR_CODE,
      ]);

      const codeReader = new BrowserMultiFormatReader(hints);
      const videoElement = document.createElement("video");
      
      // Estilos forzados para asegurar que el video llene el contenedor
      videoElement.style.width = "100%";
      videoElement.style.height = "100%";
      videoElement.style.objectFit = "cover";

      scannerRef.current.innerHTML = "";
      scannerRef.current.appendChild(videoElement);

      navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }, // Intenta usar cámara trasera
        })
        .then((stream) => {
          videoElement.srcObject = stream;
          // Importante para iOS: playsInline evita que se vaya a pantalla completa nativa
          videoElement.setAttribute("playsinline", "true"); 
          videoElement.play();
          
          codeReader.decodeFromStream(stream, videoElement, (result) => {
            if (result) handleCameraScan(result.getText());
          });

          // Guardamos la referencia para poder limpiar después
          setScanner({
            clear: () => {
              stream.getTracks().forEach((t) => t.stop());
              codeReader.reset();
            },
          });
        })
        .catch((err) => {
          setError("No se pudo acceder a la cámara. Verifique permisos HTTPS.");
          console.error(err);
        });
    } catch (err) {
      setError("Error inicializando el lector.");
    }
  }, [handleCameraScan]);

  // Efecto para iniciar/detener
  useEffect(() => {
    if (isOpen) {
      setError(""); // Resetear errores al abrir
      const timer = setTimeout(initScanner, 300); // Pequeño delay para asegurar que el DOM renderizó
      return () => {
        clearTimeout(timer);
        if (scanner) scanner.clear();
      };
    } else {
        // Si se cierra el modal, asegurarnos de apagar la cámara
        if (scanner) {
            scanner.clear();
            setScanner(null);
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); 

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        
        {/* Header Flotante */}
        <div className={styles.modalHeader}>
          <h3>Escanear Cédula</h3>
          <button onClick={onClose} className={styles.closeButton}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {/* Área de la cámara (Video) */}
        <div ref={scannerRef} className={styles.qrReader}>
            {/* El video se inyecta aquí */}
        </div>

        {/* ELEMENTOS VISUALES (SOLO DECORACIÓN) */}
        {!error && (
          <>
            <div className={styles.scanOverlay}>
              <div className={styles.scanLine}></div>
            </div>
            <p className={styles.scanInstruction}>
              Ubica el código de barras aquí
            </p>
          </>
        )}

        {/* Mensaje de Error si falla la cámara */}
        {error && (
          <div style={{
            position: 'absolute', 
            top: '50%', 
            left: 0,
            right: 0,
            transform: 'translateY(-50%)',
            textAlign: 'center', 
            color: 'white',
            padding: '20px',
            background: 'rgba(0,0,0,0.7)'
          }}>
            <p>{error}</p>
            <button 
                onClick={onClose}
                style={{
                    marginTop: '10px',
                    padding: '8px 16px',
                    background: 'white',
                    border: 'none',
                    borderRadius: '4px'
                }}
            >
                Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScannerModal;