import React, { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes, faBolt } from "@fortawesome/free-solid-svg-icons"; // Importamos rayo para flash
import styles from "./styles.module.css";
import { APELLIDOS_COLOMBIANOS } from "../utils/apellidos_colombianos";

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
  const [error, setError] = useState("");
  
  // Estado para controlar la linterna
  const [track, setTrack] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  
  // Referencia al lector para poder limpiarlo
  const codeReaderRef = useRef(null);

  const handleCameraScan = useCallback((text) => {
    // Si lee algo muy corto, lo ignoramos para no procesar basura
    if (text.length < 10) return;

    const cleanText = text.replace(/<F\d+>/gi, "").replace(/<CR>|<LF>|<GS>|<RS>|<US>/gi, "");
    const resultado = parsearDatosEscaneados(cleanText);
    
    if (resultado) {
      onScan(resultado);
      onClose();
    }
  }, [onScan, onClose]);

  // Función para activar/desactivar linterna
  const toggleTorch = async () => {
    if (track && hasTorch) {
      try {
        await track.applyConstraints({
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
      // 1. CONFIGURACIÓN "TRY HARDER" PARA PDF417
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.PDF_417, // Prioridad absoluta
        BarcodeFormat.QR_CODE
      ]);
      // Esto hace que el procesador sea más lento pero mucho más preciso
      hints.set(DecodeHintType.TRY_HARDER, true); 

      const codeReader = new BrowserMultiFormatReader(hints);
      codeReaderRef.current = codeReader;

      const videoElement = document.createElement("video");
      videoElement.style.width = "100%";
      videoElement.style.height = "100%";
      videoElement.style.objectFit = "cover";
      
      scannerRef.current.innerHTML = "";
      scannerRef.current.appendChild(videoElement);

      // 2. PEDIR CÁMARA CON ALTA RESOLUCIÓN (CRÍTICO PARA PDF417)
      const constraints = {
        video: { 
          facingMode: "environment",
          width: { ideal: 1920 }, // Full HD idealmente
          height: { ideal: 1080 },
          focusMode: "continuous" // Intentar forzar autoenfoque
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // 3. DETECTAR SI TIENE LINTERNA
      const videoTrack = stream.getVideoTracks()[0];
      setTrack(videoTrack);
      
      // Chequear capacidades
      const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
      if (capabilities.torch) {
        setHasTorch(true);
      }

      videoElement.srcObject = stream;
      videoElement.setAttribute("playsinline", "true");
      await videoElement.play();

      // Iniciar decodificación
      codeReader.decodeFromStream(stream, videoElement, (result, err) => {
        if (result) {
          handleCameraScan(result.getText());
        }
      });

    } catch (err) {
      console.error("Error cámara:", err);
      setError("No se pudo iniciar la cámara de alta resolución.");
    }
  }, [handleCameraScan]);

  // Limpieza al cerrar
  useEffect(() => {
    if (isOpen) {
      setError("");
      setTorchOn(false);
      // Pequeño delay para asegurar DOM
      const t = setTimeout(initScanner, 300);
      return () => clearTimeout(t);
    } else {
      if (codeReaderRef.current) {
        codeReaderRef.current.reset();
      }
      if (track) {
        track.stop(); // Detener el track de video físicamente
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        
        <div className={styles.modalHeader}>
          <h3>Escanear Cédula (PDF417)</h3>
          <button onClick={onClose} className={styles.closeButton}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div ref={scannerRef} className={styles.qrReader} />

        {/* OVERLAY RECTANGULAR PARA CÉDULA */}
        {!error && (
          <>
            <div className={styles.scanOverlay}>
              <div className={styles.scanLine}></div>
            </div>
            <p className={styles.scanInstruction}>
              Ubica el código de barras dentro del rectángulo.<br/>
              Asegura buena iluminación.
            </p>

            {/* BOTÓN DE LINTERNA (Solo si el dispositivo lo soporta) */}
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

        {error && (
          <div style={{position: 'absolute', top: '50%', textAlign: 'center', width: '100%', color: 'white'}}>
            <p>{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScannerModal;