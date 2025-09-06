/**
 * 사용자 동의 관리
 */

class ConsentManager {
  static async checkConsent() {
    try {
      const result = await chrome.storage.sync.get(['userConsent']);
      return result.userConsent === true;
    } catch (error) {
      console.error('Failed to check consent:', error);
      return false;
    }
  }
  
  static async showConsentDialog() {
    return new Promise((resolve) => {
      // amazonq-ignore-next-line
      const overlay = document.createElement('div');
      overlay.innerHTML = `
        <div class="consent-overlay">
          <div class="consent-dialog">
            <h3>🛡️ 데이터 수집 동의</h3>
            <p><strong>AWS Cloud Pilot</strong>이 보안 분석을 위해 다음 정보를 수집합니다:</p>
            <ul>
              <li>AWS Console API 요청 정보 (민감정보 자동 마스킹)</li>
              <li>페이지 URL 및 사용 패턴</li>
            </ul>
            <div class="consent-notice">
              ✅ 액세스 키, 비밀번호 등 민감정보는 자동 마스킹<br>
              ✅ HTTPS 암호화 전송<br>
              ✅ 보안 조언 목적으로만 사용
            </div>
            <div class="consent-buttons">
              <button id="consent-accept">동의하고 시작</button>
              <button id="consent-decline">거부</button>
            </div>
          </div>
        </div>
      `;
      
      const style = document.createElement('style');
      style.textContent = `
        .consent-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.7);
          z-index: 99999;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .consent-dialog {
          background: white;
          padding: 24px;
          border-radius: 8px;
          max-width: 500px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .consent-notice {
          background: #f8f9fa;
          padding: 12px;
          border-radius: 4px;
          margin: 16px 0;
          font-size: 14px;
        }
        .consent-buttons {
          display: flex;
          gap: 12px;
          margin-top: 20px;
        }
        .consent-buttons button {
          flex: 1;
          padding: 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        #consent-accept {
          background: #007dbc;
          color: white;
        }
        #consent-decline {
          background: #6c757d;
          color: white;
        }
      `;
      
      document.head.appendChild(style);
      document.body.appendChild(overlay);
      
      const acceptBtn = overlay.querySelector('#consent-accept');
      const declineBtn = overlay.querySelector('#consent-decline');
      
      if (acceptBtn) {
        acceptBtn.onclick = async () => {
          try {
            await chrome.storage.sync.set({ userConsent: true });
            overlay.remove();
            resolve(true);
          } catch (error) {
            console.error('Failed to save consent:', error);
            overlay.remove();
            resolve(false);
          }
        };
      }
      
      if (declineBtn) {
        declineBtn.onclick = () => {
          overlay.remove();
          resolve(false);
        };
      }
    });
  }
}

window.ConsentManager = ConsentManager;