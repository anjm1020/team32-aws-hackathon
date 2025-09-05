/**
 * AWS Console Security Assistant - Content Script
 * AWS Console 페이지에서 사용자 인터페이스 제공
 */

// 동의 관리자 로드 (안전한 DOM 접근)
let consentLoadAttempts = 0;
const MAX_CONSENT_ATTEMPTS = 50;

function loadConsentScript() {
  try {
    if (consentLoadAttempts >= MAX_CONSENT_ATTEMPTS) {
      console.warn('Consent script 로드 최대 시도 횟수 초과');
      // amazonq-ignore-next-line
      return;
    }
    
    consentLoadAttempts++;
    
    if (document && document.head) {
      const consentScript = document.createElement('script');
      consentScript.src = chrome.runtime.getURL('consent.js');
      document.head.appendChild(consentScript);
    } else {
      setTimeout(loadConsentScript, 100);
    }
  } catch (error) {
    console.warn('Consent script 로드 실패:', error);
  }
}

// DOM 완전 로드 후 실행
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadConsentScript);
} else {
  loadConsentScript();
}

let awsChatbot = null;

/**
 * 챗봇 토글 (CloudTrail 방식)
 */
function toggleChatbot() {
  if (awsChatbot) {
    hideChatbot();
    return;
  }
  showChatbot();
}

/**
 * 챗봇 표시
 */
function showChatbot() {
  if (!awsChatbot) {
    createChatbot();
  }
}

/**
 * 챗봇 숨김
 */
function hideChatbot() {
  if (awsChatbot) {
    awsChatbot.remove();
    awsChatbot = null;
  }
}

/**
 * 챗봇 생성
 */
function createChatbot() {
  awsChatbot = document.createElement('div');
  awsChatbot.id = 'aws-security-chatbot';
  awsChatbot.innerHTML = `
    <div class="chatbot-header">
      <span>🛡️ AWS Security Assistant</span>
      <div class="chatbot-controls">
        <button class="chatbot-warning" title="CloudTrail 오류 확인">⚠️</button>
        <button class="chatbot-clear" title="채팅 내역 지우기">🗑️</button>
        <button class="chatbot-close">×</button>
      </div>
    </div>
    <div class="chatbot-messages" id="chatbot-messages">
      <div class="message bot-message">
        👋 안녕하세요! AWS 보안 어시스턴트입니다.<br><br>
        🔍 AWS Console 작업을 모니터링하고 있습니다.
      </div>
    </div>
    <div class="chatbot-input">
      <input type="text" placeholder="질문을 입력하세요..." id="chatbot-input">
      <button id="chatbot-profile">👤</button>
      <button id="chatbot-send">전송</button>
    </div>
  `;
  
  awsChatbot.style.cssText = `
    position: fixed !important;
    bottom: 90px !important;
    right: 20px !important;
    width: 350px !important;
    height: 400px !important;
    background: white !important;
    border: 1px solid #ddd !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
    z-index: 100000 !important;
    font-family: Arial, sans-serif !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
  `;
  
  if (!document.getElementById('chatbot-style')) {
    const style = document.createElement('style');
    style.id = 'chatbot-style';
    style.textContent = `
      .chatbot-header {
        background: #232f3e !important;
        color: white !important;
        padding: 12px !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        cursor: move !important;
      }
      .chatbot-controls {
        display: flex !important;
        gap: 8px !important;
      }
      .chatbot-close, .chatbot-clear, .chatbot-warning {
        background: none !important;
        border: none !important;
        color: white !important;
        font-size: 18px !important;
        cursor: pointer !important;
        padding: 4px !important;
        border-radius: 4px !important;
      }
      .chatbot-close:hover, .chatbot-clear:hover, .chatbot-warning:hover {
        background: rgba(255,255,255,0.2) !important;
      }
      .chatbot-messages {
        flex: 1 !important;
        padding: 12px !important;
        overflow-y: auto !important;
      }
      .message {
        margin-bottom: 12px !important;
        padding: 8px 12px !important;
        border-radius: 12px !important;
        max-width: 90% !important;
        word-wrap: break-word !important;
        white-space: pre-wrap !important;
        font-size: 12px !important;
      }
      .bot-message {
        background: #f0f0f0 !important;
      }
      .user-message {
        background: #007dbc !important;
        color: white !important;
        margin-left: auto !important;
      }
      .chatbot-input {
        display: flex !important;
        padding: 12px !important;
        border-top: 1px solid #eee !important;
      }
      #chatbot-input {
        flex: 1 !important;
        padding: 8px !important;
        border: 1px solid #ddd !important;
        border-radius: 4px !important;
        margin-right: 8px !important;
      }
      #chatbot-profile {
        background: #28a745 !important;
        color: white !important;
        border: none !important;
        padding: 8px 12px !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        margin-right: 8px !important;
      }
      #chatbot-profile:hover {
        background: #1e7e34 !important;
      }
      #chatbot-send {
        background: #007dbc !important;
        color: white !important;
        border: none !important;
        padding: 8px 16px !important;
        border-radius: 6px !important;
        cursor: pointer !important;
      }
      #chatbot-send:hover {
        background: #0056b3 !important;
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(awsChatbot);
  
  // 채팅 내역 복원
  loadChatHistory();
  
  const closeBtn = awsChatbot.querySelector('.chatbot-close');
  closeBtn.onclick = function(e) {
    e.stopPropagation();
    hideChatbot();
  };
  
  const clearBtn = awsChatbot.querySelector('.chatbot-clear');
  clearBtn.onclick = function(e) {
    e.stopPropagation();
    clearChatHistory();
  };
  
  const profileBtn = awsChatbot.querySelector('#chatbot-profile');
  profileBtn.onclick = function() {
    openProfileWindow();
  };
  
  const sendBtn = awsChatbot.querySelector('#chatbot-send');
  sendBtn.onclick = function() {
    const input = awsChatbot.querySelector('#chatbot-input');
    if (input.value.trim()) {
      addMessage(input.value.trim(), 'user');
      input.value = '';
    }
  };
  
  const inputField = awsChatbot.querySelector('#chatbot-input');
  inputField.onkeypress = function(e) {
    if (e.key === 'Enter') {
      sendBtn.click();
    }
  };
  
  const warningBtn = awsChatbot.querySelector('.chatbot-warning');
  warningBtn.onclick = function(e) {
    e.stopPropagation();
    toggleCloudTrailPopup();
  };
  
  makeChatbotDraggable(awsChatbot);
}

/**
 * 챗봇 드래그 기능
 */
function makeChatbotDraggable(chatbot) {
  const header = chatbot.querySelector('.chatbot-header');
  let isDragging = false;
  let startX, startY, startLeft, startTop;
  
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    let newLeft = startLeft + deltaX;
    let newTop = startTop + deltaY;
    
    // 화면 범위 내로 제한
    const maxLeft = window.innerWidth - chatbot.offsetWidth;
    const maxTop = window.innerHeight - chatbot.offsetHeight;
    
    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));
    
    chatbot.style.left = newLeft + 'px';
    chatbot.style.top = newTop + 'px';
  };
  
  const handleMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  };
  
  header.onmousedown = (e) => {
    // 버튼 클릭 시 드래그 방지
    if (e.target.classList.contains('chatbot-close') || e.target.classList.contains('chatbot-clear') || e.target.classList.contains('chatbot-warning')) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    const rect = chatbot.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    
    // 기본 위치 설정 제거
    chatbot.style.right = 'auto';
    chatbot.style.bottom = 'auto';
    chatbot.style.left = startLeft + 'px';
    chatbot.style.top = startTop + 'px';
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    e.preventDefault();
  };
}









/**
 * 서버에서 프로파일 로드
 */
function loadProfileFromServer(textarea) {
  chrome.runtime.sendMessage({
    action: 'fetchProfile'
  }, (response) => {
    if (chrome.runtime.lastError) {
      textarea.placeholder = '네트워크 오류';
      return;
    }
    
    if (response && response.success) {
      if (response.data && response.data.trim()) {
        textarea.value = response.data.trim();
      } else {
        textarea.placeholder = 'profile 입력';
      }
    } else {
      textarea.placeholder = '네트워크 오류';
    }
  });
}

/**
 * 프로파일 창 열기
 */
function openProfileWindow() {
  // 이미 열린 프로파일 창이 있으면 리턴
  if (document.getElementById('profile-window')) {
    return;
  }
  
  const profileWindow = document.createElement('div');
  profileWindow.id = 'profile-window';
  profileWindow.innerHTML = `
    <div class="profile-overlay">
      <div class="profile-container">
        <h3>👤 프로파일 설정</h3>
        <textarea id="profile-text" placeholder="프로파일을 입력하세요..." readonly></textarea>
        <div class="profile-buttons">
          <button id="profile-edit">Edit</button>
          <button id="profile-submit">Submit</button>
          <button id="profile-close">×</button>
        </div>
      </div>
    </div>
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    .profile-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7); z-index: 99999;
      display: flex; align-items: center; justify-content: center;
    }
    .profile-container {
      background: white; padding: 32px; border-radius: 12px;
      width: 450px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      min-width: 300px; position: relative;
    }

    .profile-container h3 {
      margin: 0 0 20px 0; color: #333; font-size: 18px;
    }
    #profile-text {
      width: calc(100% - 24px); height: 120px; padding: 12px;
      border: 2px solid #e0e0e0; border-radius: 8px;
      background: #f8f9fa; resize: none; font-family: 'Segoe UI', sans-serif;
      font-size: 14px; line-height: 1.4; transition: all 0.2s ease; box-sizing: border-box;
    }
    #profile-text.editing { 
      background: white; border-color: #6f42c1; box-shadow: 0 0 0 3px rgba(111,66,193,0.1);
    }
    .profile-buttons {
      display: flex; gap: 12px; margin-top: 20px; justify-content: flex-end;
      width: 100%; box-sizing: border-box;
    }
    .profile-buttons button {
      padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer;
      font-weight: 500; transition: all 0.2s ease;
    }
    #profile-edit { background: #007dbc; color: white; }
    #profile-edit:hover { background: #0056b3; }
    #profile-submit { background: #28a745; color: white; }
    #profile-submit:hover { background: #1e7e34; }
    #profile-close { background: #dc3545; color: white; }
    #profile-close:hover { background: #c82333; }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(profileWindow);
  
  const textarea = profileWindow.querySelector('#profile-text');
  const editBtn = profileWindow.querySelector('#profile-edit');
  const submitBtn = profileWindow.querySelector('#profile-submit');
  const closeBtn = profileWindow.querySelector('#profile-close');
  
  // 서버에서 프로파일 로드
  loadProfileFromServer(textarea);
  
  editBtn.onclick = () => {
    textarea.classList.add('editing');
    textarea.readOnly = false;
    textarea.focus();
  };
  
  submitBtn.onclick = () => {
    const profile = textarea.value.trim();
    if (!profile) {
      addMessage('❌ 프로파일을 입력해주세요', 'bot');
      return;
    }
    
    chrome.runtime.sendMessage({
      action: 'sendProfile',
      profile: profile
    }, (response) => {
      if (chrome.runtime.lastError) {
        addMessage('❌ 전송 실패: ' + chrome.runtime.lastError.message, 'bot');
        return;
      }
      
      if (response && response.success) {
        addMessage('✅ 프로파일이 서버로 전송되었습니다!', 'bot');
        if (response.data && response.data.trim()) {
          addMessage(`📥 서버 응답: ${response.data}`, 'bot');
        }
        loadProfileFromServer(textarea);
        profileWindow.remove();
      } else {
        addMessage(`❌ 프로파일 전송 실패: ${response?.error || '알 수 없는 오류'}`, 'bot');
      }
    });
    
    textarea.classList.remove('editing');
    textarea.readOnly = true;
  };
  
  closeBtn.onclick = () => profileWindow.remove();
}

let cloudTrailPopup = null;

/**
 * CloudTrail 팝업 토글
 */
function toggleCloudTrailPopup() {
  if (cloudTrailPopup) {
    hideCloudTrailPopup();
    return;
  }
  
  showCloudTrailPopup();
}

/**
 * CloudTrail 오류 팝업 표시
 */
function showCloudTrailPopup() {
  if (!awsChatbot) return;
  
  // 팝업 생성
  cloudTrailPopup = document.createElement('div');
  cloudTrailPopup.id = 'cloudtrail-popup';
  cloudTrailPopup.innerHTML = `
    <div class="popup-header" style="background: #f8f9fa; padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: bold; display: flex; justify-content: space-between; align-items: center; cursor: move;">
      <span>⏳ CloudTrail 오류 로딩 중...</span>
      <button class="popup-close" style="background: none; border: none; color: #666; font-size: 16px; cursor: pointer; padding: 4px;">×</button>
    </div>
  `;
  
  // 스타일 적용
  cloudTrailPopup.style.cssText = `
    position: fixed !important;
    background: white !important;
    border: 1px solid #ddd !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
    z-index: 100001 !important;
    width: 350px !important;
    max-height: 300px !important;
    overflow-y: auto !important;
    font-family: Arial, sans-serif !important;
    font-size: 12px !important;
  `;
  
  // 채팅창 상단에 위치 설정
  const chatbotRect = awsChatbot.getBoundingClientRect();
  cloudTrailPopup.style.left = chatbotRect.left + 'px';
  cloudTrailPopup.style.bottom = (window.innerHeight - chatbotRect.top + 10) + 'px';
  
  document.body.appendChild(cloudTrailPopup);
  
  // X 버튼 이벤트 리스너
  const closeBtn = cloudTrailPopup.querySelector('.popup-close');
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    hideCloudTrailPopup();
  };
  
  // 드래그 기능 추가
  makePopupDraggable(cloudTrailPopup);
  
  // API 호출
  console.log('CloudTrail API 호출 시작');
  
  chrome.runtime.sendMessage({
    action: 'fetchCloudTrailFailures'
  }, (response) => {
    console.log('CloudTrail API 응답:', response);
    
    if (!cloudTrailPopup) {
      console.log('팝업이 사라졌음');
      return;
    }
    
    if (chrome.runtime.lastError) {
      console.error('Chrome runtime 오류:', chrome.runtime.lastError);
      cloudTrailPopup.innerHTML = `
        <div style="background: #f8f9fa; padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
          <span>❌ 네트워크 오류</span>
          <button onclick="hideCloudTrailPopup()" style="background: none; border: none; color: #666; font-size: 16px; cursor: pointer; padding: 0;">×</button>
        </div>
      `;
      return;
    }
    
    if (!response) {
      console.error('응답 없음');
      cloudTrailPopup.innerHTML = `
        <div style="background: #f8f9fa; padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
          <span>❌ 응답 없음</span>
          <button onclick="hideCloudTrailPopup()" style="background: none; border: none; color: #666; font-size: 16px; cursor: pointer; padding: 0;">×</button>
        </div>
      `;
      return;
    }
    
    if (!response.success) {
      console.error('API 실패:', response.error);
      cloudTrailPopup.innerHTML = `
        <div style="background: #f8f9fa; padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
          <span>❌ ${response.error || 'API 오류'}</span>
          <button onclick="hideCloudTrailPopup()" style="background: none; border: none; color: #666; font-size: 16px; cursor: pointer; padding: 0;">×</button>
        </div>
      `;
      return;
    }
    
    const data = response.data;
    console.log('CloudTrail 데이터:', data);
    
    if (!data) {
      cloudTrailPopup.innerHTML = `
        <div style="background: #f8f9fa; padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
          <span>❌ 데이터 없음</span>
          <button onclick="hideCloudTrailPopup()" style="background: none; border: none; color: #666; font-size: 16px; cursor: pointer; padding: 0;">×</button>
        </div>
      `;
      return;
    }
    
    // 팝업 내용 생성
    let content = `
      <div class="popup-header" style="background: #f8f9fa; padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: bold; display: flex; justify-content: space-between; align-items: center; cursor: move;">
        <span>⚠️ CloudTrail 오류 (${data.count || 0}개)</span>
        <button class="popup-close" style="background: none; border: none; color: #666; font-size: 16px; cursor: pointer; padding: 4px;">×</button>
      </div>
    `;
    
    if (data.events && data.events.length > 0) {
      data.events.forEach((event) => {
        content += `
          <div style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0;">
            <div style="font-weight: bold; color: #dc3545; margin-bottom: 4px;">${event.ErrorCode}</div>
            <div><a href="${event.URL}" target="_blank" style="color: #007dbc; text-decoration: none; font-size: 11px;">클릭하여 상세 보기</a></div>
          </div>
        `;
      });
    } else {
      content += '<div style="padding: 12px; text-align: center; color: #28a745;">✅ 오류 없음</div>';
    }
    
    cloudTrailPopup.innerHTML = content;
    
    // X 버튼 이벤트 리스너 재등록
    const closeBtn = cloudTrailPopup.querySelector('.popup-close');
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      hideCloudTrailPopup();
    };
    
    // 드래그 기능 재등록
    makePopupDraggable(cloudTrailPopup);
    
    console.log('팝업 내용 업데이트 완료');
  });
}

/**
 * CloudTrail 오류 팝업 숨김
 */
function hideCloudTrailPopup() {
  if (cloudTrailPopup) {
    console.log('팝업 숨김');
    cloudTrailPopup.remove();
    cloudTrailPopup = null;
  }
}

/**
 * 팝업 드래그 기능
 */
function makePopupDraggable(popup) {
  const header = popup.querySelector('.popup-header');
  if (!header) return;
  
  let isDragging = false;
  let startX, startY, startLeft, startTop;
  
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    let newLeft = startLeft + deltaX;
    let newTop = startTop + deltaY;
    
    // 화면 범위 내로 제한
    const maxLeft = window.innerWidth - popup.offsetWidth;
    const maxTop = window.innerHeight - popup.offsetHeight;
    
    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));
    
    popup.style.left = newLeft + 'px';
    popup.style.top = newTop + 'px';
  };
  
  const handleMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  };
  
  header.onmousedown = (e) => {
    // X 버튼 클릭 시 드래그 방지
    if (e.target.classList.contains('popup-close')) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    const rect = popup.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    
    // 기본 위치 설정 제거
    popup.style.bottom = 'auto';
    popup.style.left = startLeft + 'px';
    popup.style.top = startTop + 'px';
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    e.preventDefault();
  };
}

// 전역 함수로 등록 (인라인 onclick에서 사용)
window.hideCloudTrailPopup = hideCloudTrailPopup;
window.hideChatbot = hideChatbot;

/**
 * 채팅 내역 저장
 */
function saveChatHistory() {
  const messagesContainer = document.getElementById('chatbot-messages');
  if (messagesContainer) {
    const messages = Array.from(messagesContainer.children).map(msg => ({
      className: msg.className,
      content: msg.innerHTML
    }));
    localStorage.setItem('aws-chat-history', JSON.stringify(messages));
  }
}

/**
 * 채팅 내역 복원
 */
function loadChatHistory() {
  const messagesContainer = document.getElementById('chatbot-messages');
  if (messagesContainer) {
    const saved = localStorage.getItem('aws-chat-history');
    if (saved) {
      try {
        const messages = JSON.parse(saved);
        messagesContainer.innerHTML = '';
        messages.forEach(msg => {
          const div = document.createElement('div');
          div.className = msg.className;
          div.innerHTML = msg.content;
          messagesContainer.appendChild(div);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return;
      } catch (e) {}
    }
    // 기본 메시지
    messagesContainer.innerHTML = `
      <div class="message bot-message">
        👋 안녕하세요! AWS 보안 어시스턴트입니다.<br><br>
        🔍 AWS Console 작업을 모니터링하고 있습니다.
      </div>
    `;
  }
}

/**
 * 채팅 내역 지우기
 */
function clearChatHistory() {
  localStorage.removeItem('aws-chat-history');
  loadChatHistory();
}

/**
 * 메시지 추가
 */
function addMessage(text, sender) {
  if (!awsChatbot) {
    createChatbot();
  }
  
  const messagesContainer = awsChatbot.querySelector('#chatbot-messages');
  if (!messagesContainer) return;
  
  const isAtBottom = messagesContainer.scrollTop + messagesContainer.clientHeight >= messagesContainer.scrollHeight - 20;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}-message`;
  messageDiv.textContent = text;
  
  messagesContainer.appendChild(messageDiv);
  
  if (isAtBottom) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  // 채팅 내역 저장
  saveChatHistory();
}

/**
 * 보안 경고 표시
 */
function showSecurityAlert(message) {
  if (!awsChatbot) showChatbot();
  addMessage(`⚠️ 보안 알림: ${message}`, 'bot');
}

let buttonCreateAttempts = 0;
const MAX_BUTTON_ATTEMPTS = 50;

/**
 * 플로팅 버튼 생성
 */
function createFloatingButton() {
  const existingButton = document.getElementById('aws-security-button');
  if (existingButton) {
    existingButton.remove();
  }
  
  if (!document.body) {
    setTimeout(createFloatingButton, 100);
    return;
  }
    
  const button = document.createElement('button');
  button.id = 'aws-security-button';
  button.textContent = '🛡️';
  button.title = 'AWS Security Assistant';
    
  button.style.cssText = `
    position: fixed !important;
    bottom: 20px !important;
    right: 20px !important;
    width: 60px !important;
    height: 60px !important;
    border-radius: 50% !important;
    background: #232f3e !important;
    color: white !important;
    border: none !important;
    font-size: 24px !important;
    cursor: pointer !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
    z-index: 99999 !important;
  `;
    
  button.onclick = function() {
    toggleChatbot();
  };
    
  document.body.appendChild(button);
}

/**
 * AWS Console 페이지 감지 및 초기화
 */
async function initializeOnAwsConsole() {
  // AWS Console 페이지인지 확인
  if (window.location.hostname.includes('console.aws.amazon.com') || 
      window.location.hostname.includes('amazonaws.com')) {
    
    // amazonq-ignore-next-line
    // DOM 로드 대기
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(checkConsentAndInit, 500);
      });
    } else {
      setTimeout(checkConsentAndInit, 500);
    }
  }
}

async function checkConsentAndInit() {
  // UI 먼저 생성
  initializeUI();
  
  // 동의 확인은 비동기로 처리 (오류 방지)
  setTimeout(async () => {
    try {
      const hasConsent = await chrome.storage.sync.get(['userConsent']);
      if (!hasConsent.userConsent) {
        // ConsentManager 로드 대기 및 다이얼로그 표시
        let attempts = 0;
        const MAX_CONSENT_SHOW_ATTEMPTS = 30;
        const showConsent = () => {
          attempts++;
          if (window.ConsentManager && typeof window.ConsentManager.showConsentDialog === 'function') {
            window.ConsentManager.showConsentDialog();
          } else if (attempts < MAX_CONSENT_SHOW_ATTEMPTS) {
            setTimeout(showConsent, 100);
          } else {
            console.warn('ConsentManager 로드 타임아웃');
          }
        };
        showConsent();
      }
    } catch (error) {
      console.warn('동의 확인 실패:', error);
    }
  }, 2000);
// amazonq-ignore-next-line
}
// amazonq-ignore-next-line

/**
 * UI 초기화
 */
function initializeUI() {
  createFloatingButton();
  showChatbot(); // 처음에 채팅창 표시
}

/**
 * 페이지 변경 감지 (SPA 대응) - 안전 버전
 */
// amazonq-ignore-next-line
let currentUrl = window.location.href;
let pageObserver = null;
// amazonq-ignore-next-line
let observerSetupAttempts = 0;
const MAX_OBSERVER_ATTEMPTS = 5;

function setupPageObserver() {
  if (observerSetupAttempts >= MAX_OBSERVER_ATTEMPTS) {
    console.warn('MutationObserver 설정 최대 시도 횟수 초과');
    return;
  }
  
  observerSetupAttempts++;
  
  try {
    // 기존 observer 정리
    if (pageObserver) {
      pageObserver.disconnect();
      pageObserver = null;
    }
    
    // DOM 요소 존재 확인
    if (!document || !document.body) {
      setTimeout(setupPageObserver, 1000);
      return;
    }
    
    // MutationObserver 생성 및 설정
    pageObserver = new MutationObserver((mutations) => {
      try {
        // URL 변경 감지
        if (window.location.href !== currentUrl) {
          currentUrl = window.location.href;
          console.log('페이지 변경 감지, UI 재생성:', currentUrl);
          
          // UI 재생성
          
          // UI 재생성
          setTimeout(createFloatingButton, 1000);
        }
        
        // 버튼이 DOM에서 제거되었는지 확인
        if (!document.getElementById('aws-security-button')) {
          setTimeout(createFloatingButton, 500);
        }
      } catch (error) {
        console.warn('MutationObserver 콜백 오류:', error);
      }
    });
    
    // 안전하게 observe 시작 - Node 타입 확인
    if (document.body && document.body.nodeType === Node.ELEMENT_NODE) {
      pageObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    } else {
      throw new Error('document.body is not a valid Node');
    }
    
    console.log('MutationObserver 설정 완료');
    
  } catch (error) {
    console.warn(`MutationObserver 설정 실패 (시도 ${observerSetupAttempts}):`, error);
    
    // 재시도
    if (observerSetupAttempts < MAX_OBSERVER_ATTEMPTS) {
      setTimeout(setupPageObserver, 2000);
    }
  }
}

// 안전한 Observer 설정
function initPageObserver() {
  if (document.readyState === 'complete') {
    // amazonq-ignore-next-line
    setTimeout(setupPageObserver, 500);
  } else if (document.readyState === 'interactive') {
    setTimeout(setupPageObserver, 1000);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(setupPageObserver, 1000);
    });
  }
}

// 초기화
initPageObserver();

// 백그라운드에서 오는 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'addChatMessage') {
    console.log('백그라운드에서 메시지 수신:', request.message.substring(0, 50));
    
    // 메시지 추가 (챗봇이 없으면 자동 생성)
    addMessage(request.message, request.sender);
    
    // 챗봇이 열려있지 않으면 자동으로 열기
    if (!awsChatbot) {
      showChatbot();
    }
    
    sendResponse({ success: true });
  }
});

// 초기화
initializeOnAwsConsole();