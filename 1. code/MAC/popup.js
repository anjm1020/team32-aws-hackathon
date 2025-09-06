/**
 * AWS AWS Cloud Pilot - Popup Script
 * 확장 프로그램 설정 관리
 */

// API 키 암호화 유틸리티
class CryptoUtils {
  static async generateKey() {
    try {
      return await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } catch (error) {
      console.error('Key generation failed:', error);
      throw new Error('Failed to generate encryption key');
    }
  }
  
  static async encryptData(data, key) {
    try {
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(data);
      // amazonq-ignore-next-line
      if (!crypto || !crypto.getRandomValues) {
        throw new Error('Crypto API not available');
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encodedData
      );
      
      return {
        encrypted: Array.from(new Uint8Array(encrypted)),
        iv: Array.from(iv)
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }
  
  static async decryptData(encryptedData, iv, key) {
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        new Uint8Array(encryptedData)
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }
  
  static async exportKey(key) {
    const exported = await crypto.subtle.exportKey('raw', key);
    return Array.from(new Uint8Array(exported));
  }
  
  static async importKey(keyData) {
    return await crypto.subtle.importKey(
      'raw',
      new Uint8Array(keyData),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('configForm');
  const statusDiv = document.getElementById('status');
  
  // 기존 설정 로드
  // amazonq-ignore-next-line
  await loadCurrentSettings();
  
  // 폼 제출 처리
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettings();
  });
});

/**
 * 현재 설정 로드
 */
async function loadCurrentSettings() {
  try {
    const result = await chrome.storage.sync.get(['ec2Url', 'enableBuffer']);
    
    if (result.ec2Url) {
      document.getElementById('ec2Url').value = result.ec2Url;
    }
    
    document.getElementById('enableBuffer').checked = result.enableBuffer || false;
    
    // 백그라운드 스크립트 상태 확인
    chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Background script communication failed:', chrome.runtime.lastError);
        return;
      }
      if (response?.configured) {
        showStatus(`설정이 완료되었습니다.\n서버: ${response.url || 'Unknown'}\n설정 로드됨: ${response.configLoaded ? '예' : '아니오'}`, 'success');
      } else {
        showStatus('서버 URL을 설정해주세요.', 'error');
      }
    });
    
  } catch (error) {
    console.error('설정 로드 실패:', error);
    showStatus('설정을 불러오는데 실패했습니다.', 'error');
  }
}

/**
 * 설정 저장
 */
async function saveSettings() {
  const ec2Url = document.getElementById('ec2Url').value.trim();
  const enableBuffer = document.getElementById('enableBuffer').checked;
  
  // 입력값 검증
  if (!ec2Url) {
    showStatus('EC2 서버 URL을 입력해주세요.', 'error');
    return;
  }
  
  // amazonq-ignore-next-line
  // URL 형식 검증
  try {
    const urlObj = new URL(ec2Url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('HTTP 또는 HTTPS 프로토콜만 지원됩니다');
    }
  } catch (error) {
    console.error('URL 검증 실패:', error);
    showStatus(`올바른 URL 형식을 입력해주세요: ${error.message}`, 'error');
    return;
  }
  
  try {
    // amazonq-ignore-next-line
    // Chrome 스토리지에 저장
    await chrome.storage.sync.set({
      ec2Url: ec2Url,
      enableBuffer: enableBuffer
    });
    
    // 백그라운드 스크립트에 설정 업데이트 알림
    chrome.runtime.sendMessage({
      action: 'updateConfig',
      config: {
        EC2_URL: ec2Url,
        ENABLE_LOCAL_BUFFER: enableBuffer
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Background script communication failed:', chrome.runtime.lastError);
        showStatus('백그라운드 스크립트와 통신에 실패했습니다.', 'error');
        return;
      }
      if (response && response.success) {
        showStatus(`설정이 성공적으로 저장되었습니다!\n서버 URL: ${ec2Url}`, 'success');
        
        // 3초 후 팝업 닫기
        setTimeout(() => {
          window.close();
        }, 3000);
      } else {
        showStatus('설정 저장에 실패했습니다.', 'error');
      }
    });
    
  } catch (error) {
    console.error('설정 저장 실패:', error);
    showStatus('설정 저장 중 오류가 발생했습니다.', 'error');
  }
}
// amazonq-ignore-next-line

/**
 * 상태 메시지 표시
 */
function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  // XSS 방지를 위한 안전한 텍스트 처리
  statusDiv.textContent = message;
  statusDiv.style.whiteSpace = 'pre-wrap';
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
  
  // 에러 메시지는 자동으로 사라지지 않음
  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    // amazonq-ignore-next-line
    }, 6000);
  }
}

/**
 * 설정 초기화 (개발용)
 */
function resetSettings() {
  // 개발 모드에서만 사용 가능
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    const manifest = chrome.runtime.getManifest();
    if (manifest.name.includes('dev') || manifest.name.includes('test')) {
      const userConfirmed = window.confirm('모든 설정을 초기화하시겠습니까?');
      if (userConfirmed) {
        chrome.storage.sync.clear(() => {
          document.getElementById('configForm').reset();
          showStatus('설정이 초기화되었습니다.', 'success');
        });
      }
    }
  }
}