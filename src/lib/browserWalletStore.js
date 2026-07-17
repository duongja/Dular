const DB_NAME = 'dular-self-custody'
const STORE_NAME = 'wallets'
const VERSION = 1

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'phone' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function transaction(storeMode, callback) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, storeMode)
    const store = tx.objectStore(STORE_NAME)
    const request = callback(store)
    tx.oncomplete = () => {
      db.close()
      resolve(request?.result)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error || request?.error)
    }
  }))
}

function bytesToBase64(bytes) {
  let binary = ''
  bytes.forEach((value) => {
    binary += String.fromCharCode(value)
  })
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  const result = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index)
  }
  return result
}

function randomBytes(length) {
  const result = new Uint8Array(length)
  crypto.getRandomValues(result)
  return result
}

async function deriveKey(pin, salt) {
  const encoder = new TextEncoder()
  const pinKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 250000,
      hash: 'SHA-256',
    },
    pinKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptJson(value, pin) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(pin, salt)
  const encoder = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(value)),
  )
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

async function decryptJson(payload, pin) {
  const key = await deriveKey(pin, base64ToBytes(payload.salt))
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext),
  )
  const decoder = new TextDecoder()
  return JSON.parse(decoder.decode(decrypted))
}

export async function loadWalletRecord(phone) {
  return transaction('readonly', (store) => store.get(phone))
}

export async function saveWalletRecord(record) {
  return transaction('readwrite', (store) => store.put(record))
}

export async function deleteWalletRecord(phone) {
  return transaction('readwrite', (store) => store.delete(phone))
}

export async function createWalletRecord(phone, pin) {
  const walletSecrets = {
    fiberSecretKey: bytesToBase64(randomBytes(32)),
    ckbSecretKey: bytesToBase64(randomBytes(32)),
    createdAt: new Date().toISOString(),
  }

  const encrypted = await encryptJson(walletSecrets, pin)
  const record = {
    phone,
    encrypted,
    createdAt: walletSecrets.createdAt,
    updatedAt: walletSecrets.createdAt,
    version: 1,
  }
  await saveWalletRecord(record)
  return record
}

export async function unlockWalletRecord(record, pin) {
  const payload = await decryptJson(record.encrypted, pin)
  return {
    fiberSecretKey: base64ToBytes(payload.fiberSecretKey),
    ckbSecretKey: base64ToBytes(payload.ckbSecretKey),
    createdAt: payload.createdAt,
  }
}
