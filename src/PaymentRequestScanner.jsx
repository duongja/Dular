import { useEffect, useRef, useState } from 'react'
import { Camera, ImageUp, Square } from 'lucide-react'
import QrScanner from 'qr-scanner'

export default function PaymentRequestScanner({ onScan }) {
  const videoRef = useRef(null)
  const scannerRef = useRef(null)
  const onScanRef = useRef(onScan)
  const handlingScanRef = useRef(false)
  const [cameraAvailable, setCameraAvailable] = useState(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [scanningImage, setScanningImage] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    let active = true
    QrScanner.hasCamera()
      .then((available) => {
        if (active) setCameraAvailable(available)
      })
      .catch(() => {
        if (active) setCameraAvailable(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!cameraActive || !videoRef.current) return undefined
    let disposed = false
    const scanner = new QrScanner(
      videoRef.current,
      async (result) => {
        if (disposed || handlingScanRef.current) return
        handlingScanRef.current = true
        try {
          await onScanRef.current(result.data)
          scanner.stop()
          setMessage('QR payment request captured.')
          setCameraActive(false)
        } catch (error) {
          setMessage(error.message || 'This QR code is not a Dular payment request.')
        } finally {
          handlingScanRef.current = false
        }
      },
      {
        preferredCamera: 'environment',
        maxScansPerSecond: 8,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
      },
    )
    scannerRef.current = scanner
    scanner.start()
      .then(() => {
        if (!disposed) setMessage('Point the camera at a Fiber payment QR code.')
      })
      .catch((error) => {
        if (disposed) return
        setMessage(error.message || 'Camera access was not available. Choose a QR image instead.')
        setCameraActive(false)
      })

    return () => {
      disposed = true
      scanner.destroy()
      scannerRef.current = null
    }
  }, [cameraActive])

  async function scanImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setScanningImage(true)
    setMessage('Reading QR image...')
    try {
      const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true })
      await onScanRef.current(result.data)
      setMessage('QR payment request captured.')
      setCameraActive(false)
    } catch (error) {
      setMessage(error.message === QrScanner.NO_QR_CODE_FOUND
        ? 'No readable QR code was found in that image.'
        : error.message || 'Could not read this QR image.')
    } finally {
      setScanningImage(false)
    }
  }

  function stopCamera() {
    scannerRef.current?.stop()
    setCameraActive(false)
    setMessage('Camera stopped.')
  }

  return (
    <div className="paymentQrScanner">
      {cameraActive && (
        <div className="qrVideoFrame">
          <video ref={videoRef} muted playsInline aria-label="QR code camera preview" />
        </div>
      )}
      <div className="buttonRow wrapButtons qrScannerActions">
        {cameraActive ? (
          <button type="button" className="secondaryBtn iconTextBtn" onClick={stopCamera}>
            <Square size={16} /> Stop camera
          </button>
        ) : (
          <button type="button" className="secondaryBtn iconTextBtn" onClick={() => setCameraActive(true)} disabled={cameraAvailable === false}>
            <Camera size={16} /> {cameraAvailable === null ? 'Checking camera' : 'Scan with camera'}
          </button>
        )}
        <label className={`secondaryBtn iconTextBtn filePickerBtn ${scanningImage ? 'disabled' : ''}`}>
          <ImageUp size={16} /> {scanningImage ? 'Reading image' : 'Choose QR image'}
          <input type="file" accept="image/*" onChange={scanImage} disabled={scanningImage} />
        </label>
      </div>
      {message && <p className="qrScannerMessage" role="status">{message}</p>}
    </div>
  )
}
