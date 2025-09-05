/**
 * AWS Console Security Assistant - Background Service Worker
 * AWS Console 트래픽을 모니터링하고 보안 분석을 위해 데이터를 전송
 */

// 구조화된 로깅 시스템
class Logger {
  static log(level, message, data = {}) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        data: this.sanitizeData(data),
        extension: 'aws-security-assistant',
        version: '1.0.0'
      };
      
      const logMethods = { error: 'error', warn: 'warn' };
      const logMethod = logMethods[level] || 'log';
      console[logMethod](
        `[${level.toUpperCase()}] ${message}`,
        this.sanitizeData(data)
      );
      
      // 에러는 서버로도 전송
      if (level === 'error') {
        this.sendErrorToServer(logEntry);
      }
    } catch (e) {
      console.error('로깅 실패:', e);
    }
  }
  
  static sanitizeData(data) {
    if (!data) return {};
    if (typeof data === 'string') return { message: data };
    if (data instanceof Error) return { 
      error: data.message, 
      stack: data.stack,
      name: data.name 
    };
    if (typeof data === 'object') {
      try {
        // 순환 참조 방지를 위한 안전한 직렬화
        const seen = new WeakSet();
        return JSON.parse(JSON.stringify(data, (key, val) => {
          if (val != null && typeof val === 'object') {
            if (seen.has(val)) return '[Circular]';
            seen.add(val);
          }
          // Error 객체 특별 처리
          if (val instanceof Error) {
            return {
              message: val.message,
              name: val.name,
              stack: val.stack
            };
          }
          return val;
        }));
      } catch (e) {
        return { error: String(data), parseError: e.message };
      }
    }
    return { value: String(data) };
  }
  
  static info(message, data) { this.log('info', message, data); }
  static warn(message, data) { this.log('warn', message, data); }
  static error(message, data) { this.log('error', message, data); }
  
  static async sendErrorToServer(error) {
    try {
      if (CONFIG.EC2_URL && CONFIG.EC2_URL !== '<EC2_ENDPOINT>') {
        await fetch(`${CONFIG.EC2_URL}/errors`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(error)
        });
      }
    } catch (e) {
      // 에러 전송 실패는 무시
    }
  }
}

// 화이트리스트 키워드 (중요한 AWS 액션만 필터링)
const WHITELIST_KEYWORDS = [
  'RunInstances',
  'TerminateInstances',
  'DescribeInstanceAttribute',
  'CreateBucket',
  'DeleteBucket',
  'CreateRole',
  'DeleteRole',
  'AttachUserPolicy',
  'DetachUserPolicy',
  'CreateVpc',
  'DeleteVpc',
  'CreateSecurityGroup',
  'DeleteSecurityGroup'
];

// 설정값 (환경변수나 설정 파일에서 로드해야 함)
let CONFIG = {
  EC2_URL: null,
  AUTH_KEY: null,
  ENABLE_LOCAL_BUFFER: false,
  MAX_RETRY_COUNT: 3,
  RETRY_DELAY_MS: 1000,
  TEST_MODE: false // 테스트 모드 비활성화
};

// 설정 로드 완료 플래그
let configLoaded = false;

// 테스트 모드용 전송 카운터
let testSentCount = 0;
const MAX_TEST_SENDS = 10; // 테스트 횟수 증가

// 민감정보 마스킹 패턴
const SENSITIVE_PATTERNS = [
  /accessKeyId/i,
  /secretAccessKey/i,
  /sessionToken/i,
  /authorization/i,
  /x-amz-security-token/i,
  /password/i,
  /cookie/i,
  /set-cookie/i,
  /signature/i,
  /x-api-key/i,
  /aws_access_key_id/i,
  /aws_secret_access_key/i
];

// 요청 중복 방지를 위한 캐시 (메모리만 사용)
const requestCache = new Map();
const CACHE_TTL = 5000; // 5초

// 배치 처리 클래스
class BatchProcessor {
  constructor(batchSize = 5, flushInterval = 3000) {
    this.batch = [];
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
    this.timer = null;
  }
  
  add(data) {
    this.batch.push(data);
    
    if (this.batch.length >= this.batchSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }
  
  async flush() {
    try {
      if (this.batch.length === 0) {
        return;
      }
      
      const batchData = [...this.batch];
      this.batch = [];
      
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      
      await sendToServer({ 
        type: 'batch',
        requests: batchData,
        batchId: crypto.randomUUID(),
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      // 에러 로깅만 유지
    }
  }
}

const batchProcessor = new BatchProcessor();

/**
 * 설정값을 안전하게 로드
 */
async function loadConfig() {
  try {
    Logger.info('설정 로드 시작');
    const result = await chrome.storage.sync.get(['ec2Url', 'enableBuffer']);
    
    Logger.info('스토리지에서 로드된 데이터', {
      ec2Url: result.ec2Url,
      enableBuffer: result.enableBuffer,
      keys: Object.keys(result)
    });
    
    CONFIG.EC2_URL = result.ec2Url || null;
    CONFIG.ENABLE_LOCAL_BUFFER = result.enableBuffer || false;
    configLoaded = true;
    
    Logger.info('설정 로드 완료', {
      hasUrl: !!CONFIG.EC2_URL,
      url: CONFIG.EC2_URL ? CONFIG.EC2_URL.substring(0, 50) + (CONFIG.EC2_URL.length > 50 ? '...' : '') : 'null',
      enableBuffer: CONFIG.ENABLE_LOCAL_BUFFER,
      configLoaded: configLoaded
    });
    
    // URL 유효성 검사
    if (CONFIG.EC2_URL) {
      try {
        new URL(CONFIG.EC2_URL);
        Logger.info('EC2 URL 유효성 검사 통과');
      } catch (urlError) {
        Logger.warn('EC2 URL 형식 오류', { url: CONFIG.EC2_URL, error: urlError.message });
      }
    }
    
  } catch (error) {
    Logger.error('설정 로드 실패', { error: error.message, stack: error.stack });
    configLoaded = true; // 실패해도 로드 완료로 표시
  }
}

/**
 * 민감정보 마스킹
 */
function maskSensitiveData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const masked = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
    
    if (isSensitive) {
      masked[key] = '***MASKED***';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value);
    } else {
      masked[key] = value;
    }
  }
  
  return masked;
}

/**
 * Content-Type 헤더 추출
 */
function getContentType(headers) {
  if (!headers) return null;
  const contentTypeHeader = headers.find(h => 
    h.name.toLowerCase() === 'content-type'
  );
  return contentTypeHeader ? contentTypeHeader.value : null;
}

/**
 * 요청 바디 파싱
 */
function parseRequestBody(requestBody, contentType) {
  if (!requestBody) return null;
  
  try {
    // Chrome webRequest API의 requestBody 구조 처리
    if (requestBody.formData) {
      return { formData: requestBody.formData };
    }
    
    if (requestBody.raw) {
      const rawData = requestBody.raw.map(item => {
        if (item.bytes) {
          // ArrayBuffer를 문자열로 변환
          const decoder = new TextDecoder();
          return decoder.decode(item.bytes);
        }
        return item.file || 'binary data';
      }).join('');
      
      // JSON 파싱 시도
      if (contentType && contentType.includes('application/json')) {
        try {
          return JSON.parse(rawData);
        } catch (e) {
          return { rawData, parseError: 'Invalid JSON' };
        }
      }
      
      return { rawData };
    }
    
    return requestBody;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * 중복 요청 체크
 */
function isDuplicateRequest(requestId) {
  const now = Date.now();
  
  // 캐시 정리
  for (const [id, timestamp] of requestCache.entries()) {
    if (now - timestamp > CACHE_TTL) {
      requestCache.delete(id);
    }
  }
  
  if (requestCache.has(requestId)) {
    return true;
  }
  
  requestCache.set(requestId, now);
  return false;
}

/**
 * POST 요청으로 데이터 전송
 */
async function sendToServer(data, retryCount = 0) {
  try {
    if (!CONFIG.EC2_URL) {
      Logger.error('서버 URL 미설정', { configLoaded, CONFIG });
      return false;
    }
    
    // 데이터 마스킹 및 준비
    const maskedData = maskSensitiveData(data);
    const jsonData = JSON.stringify(maskedData, null, 2);
    
    // 요청 JSON을 채팅창에 표시
    sendChatMessage('user', `${jsonData}`);
    
    let serverUrl = CONFIG.EC2_URL;
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = 'http://' + serverUrl;
    }
    
    const response = await fetch(`${serverUrl}/api/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: jsonData
    });

    Logger.info('서버 응답 상태', { 
      status: response.status, 
      statusText: response.statusText,
      contentType: response.headers.get('content-type')
    });
    
    // 204 No Content 처리
    if (response.status === 204) {
      sendChatMessage('bot', '📥 서버 응답: READ 요청으로 판단 (204 No Content)');
      return true;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // 모든 응답을 text로 받아서 처리
    const responseData = await response.text();
    
    if (responseData && responseData.trim()) {
      // JSON 형식인지 확인
      try {
        const jsonData = JSON.parse(responseData);
        const formattedJson = JSON.stringify(jsonData, null, 2);
        sendChatMessage('bot', `📥 서버 JSON 응답:\n${formattedJson}`);
      } catch (e) {
        // JSON이 아니면 그대로 텍스트로 표시
        sendChatMessage('bot', `📥 서버 응답:\n${responseData}`);
      }
    } else {
      sendChatMessage('bot', '✅ 서버 응답 완룜 (응답 데이터 없음)');
    }
    
    Logger.info('서버 전송 성공', { 
      dataSize: jsonData.length, 
      responseStatus: response.status,
      responseLength: responseData.length 
    });
    
    return true;
    
  } catch (error) {
    Logger.error('서버 전송 실패', {
      error: error.message,
      url: CONFIG.EC2_URL,
      retryCount,
      dataType: data?.type
    });
    
    // 재시도 로직
    if (retryCount < CONFIG.MAX_RETRY_COUNT) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY_MS));
      return sendToServer(data, retryCount + 1);
    }
    
    return false;
  }
}

/**
 * 요청 데이터 포맷팅
 */
function formatRequestData(data) {
  if (!data) return 'Empty data';
  return `Type: ${data.type}\nSize: ${JSON.stringify(data).length} bytes`;
}

/**
 * 서버 응답 포맷팅
 */
function formatServerResponse(responseData) {
  if (!responseData) return '✅ 서버 응답을 받았습니다.';
  
  if (typeof responseData === 'string') {
    return `📝 서버 응답:\n\n${responseData}`;
  }
  
  return `📝 서버 응답:\n\n${JSON.stringify(responseData, null, 2)}`;
}

/**
 * 채팅 메시지 전송
 */
function sendChatMessage(sender, message) {
  // 모든 AWS Console 탭에 메시지 전송
  chrome.tabs.query(
    { url: ['*://*.console.aws.amazon.com/*', '*://*.amazonaws.com/*'] },
    (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'addChatMessage',
          sender: sender,
          message: message,
          timestamp: new Date().toISOString()
        }).catch(() => {}); // 에러 무시
      });
    }
  );
}

/**
 * AWS 서비스 추출
 */
function extractAwsService(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // AWS 서비스 패턴 매칭
    if (hostname.includes('ec2')) return 'ec2';
    if (hostname.includes('s3')) return 's3';
    if (hostname.includes('iam')) return 'iam';
    if (hostname.includes('lambda')) return 'lambda';
    if (hostname.includes('rds')) return 'rds';
    if (hostname.includes('cloudformation')) return 'cloudformation';
    if (hostname.includes('cloudwatch')) return 'cloudwatch';
    if (hostname.includes('vpc')) return 'vpc';

    // Console URL에서 서비스 추출
    if (hostname.includes('console.aws.amazon.com')) {
      const pathParts = urlObj.pathname.split('/');
      if (pathParts.length > 1) {
        return pathParts[1]; // /ec2/, /s3/ 등
      }
    }
    
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

/**
 * AWS 액션 추출
 */
function extractAwsAction(url, headers) {
  try {
    // X-Amz-Target 헤더에서 액션 추출
    const targetHeader = headers?.find(h => 
      h.name.toLowerCase() === 'x-amz-target'
    );
    if (targetHeader) {
      const parts = targetHeader.value.split('.');
      return parts[parts.length - 1];
    }
    
    const urlObj = new URL(url);
    
    // URL 파라미터에서 Action 추출
    const actionParam = urlObj.searchParams.get('Action');
    if (actionParam) {
      return actionParam;
    }
    
    // 경로에서 액션 추정
    const pathActions = {
      describe: 'Describe',
      create: 'Create', 
      delete: 'Delete',
      update: 'Update',
      list: 'List'
    };
    
    const path = urlObj.pathname.toLowerCase();
    for (const [key, value] of Object.entries(pathActions)) {
      if (path.includes(key)) return value;
    }
    
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

// 필터링 제거 - 모든 요청 처리

/**
 * AWS Console 요청 처리
 */
function handleAwsRequest(details) {
  try {
    // 설정 로드 상태 확인
    if (!configLoaded) {
      return;
    }
    
    // 화이트리스트: 중요한 AWS API만 처리
    const isImportantAwsApi = 
      details.url.includes('ec2.') ||
      details.url.includes('s3.') ||
      details.url.includes('iam.') ||
      details.url.includes('lambda.') ||
      details.url.includes('rds.') ||
      details.url.includes('cloudformation.') ||
      details.url.includes('cloudwatch.') ||
      details.url.includes('logs.') ||
      details.url.includes('vpc.') ||
      details.url.includes('elasticloadbalancing.') ||
      (details.url.includes('amazonaws.com') && details.method === 'POST');
    
    if (!isImportantAwsApi) {
      return;
    }
    
    const requestId = `${details.method}-${details.url}-${Date.now()}`;
    if (isDuplicateRequest(requestId)) {
      return;
    }
    
    const parsedBody = details.requestBody ? parseRequestBody(details.requestBody, getContentType(details.requestHeaders)) : null;
    
    // 모든 요청 처리 (필터링 제거)
    const action = extractAwsAction(details.url, details.requestHeaders) || 
                   parsedBody?.formData?.Action?.[0] || 'unknown';
    
    const requestData = {
      timestamp: new Date().toISOString(),
      method: details.method,
      url: details.url,
      action: action,
      requestBody: parsedBody,
      type: details.type,
      initiator: details.initiator
    };
    
    // 요청 데이터를 채팅창에 JSON으로 표시
    const displayData = {
      timestamp: requestData.timestamp,
      method: details.method,
      url: details.url,
      action: action,
      requestBody: parsedBody
    };
    
    batchProcessor.add(requestData);
    
  } catch (error) {
    const errorMsg = `❌ handleAwsRequest 오류: ${error.message}`;
    sendChatMessage('bot', errorMsg);
    sendChatMessage('bot', `🔧 스택: ${error.stack}`);
    Logger.error('handleAwsRequest 실패', { error: error.message, stack: error.stack });
  }
}

/**
 * 웹 요청 리스너 등록
 */
chrome.webRequest.onBeforeRequest.addListener(
  handleAwsRequest,
  {
    urls: [
      "*://*.amazonaws.com/*",
      "*://*.console.aws.amazon.com/*"
    ]
  },
  ["requestBody", "extraHeaders"]
);

// 요청 헤더 정보 수집
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.url.includes('amazonaws.com')) {
      Logger.info('AWS 요청 헤더', {
        requestId: details.requestId,
        headers: maskSensitiveData(details.requestHeaders || [])
      });
    }
  },
  {
    urls: [
      "*://*.amazonaws.com/*",
      "*://*.console.aws.amazon.com/*"
    ]
  },
  ["requestHeaders", "extraHeaders"]
);

/**
 * 확장 프로그램 시작 시 설정 로드
 */
chrome.runtime.onStartup.addListener(loadConfig);
chrome.runtime.onInstalled.addListener(loadConfig);

// 즉시 설정 로드
loadConfig();

/**
 * 테마에 따른 아이콘 변경
 */
function updateExtensionIcon(theme) {
  const iconFile = theme === 'dark' ? 'aws-color(black).png' : 'aws-color(white).png';
  const iconPath = theme === 'dark' ? 'icons/black/' : 'icons/white/';
  
  chrome.action.setIcon({
    path: {
      '16': iconPath + iconFile,
      '48': iconPath + iconFile,
      '128': iconPath + iconFile
    }
  });
}

/**
 * 메시지 핸들러 (popup이나 content script와 통신)
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;
  
  switch (action) {
    case 'getStatus':
      sendResponse({
        configured: !!CONFIG.EC2_URL && CONFIG.EC2_URL !== '<EC2_ENDPOINT>',
        url: CONFIG.EC2_URL,
        configLoaded: configLoaded,
        cacheSize: requestCache.size
      });
      return true;
      
    case 'updateConfig':
      CONFIG = { ...CONFIG, ...request.config };
      chrome.storage.sync.set({
        ec2Url: CONFIG.EC2_URL,
        enableBuffer: CONFIG.ENABLE_LOCAL_BUFFER
      });
      sendResponse({ success: true });
      return true;
      
    case 'themeChanged':
      updateExtensionIcon(request.theme);
      Logger.info('테마 변경됨', { theme: request.theme });
      return true;
      
    case 'testSend':
      const testData = {
        type: 'test',
        message: '테스트 요청입니다',
        timestamp: new Date().toISOString(),
        query: 'AWS 보안 테스트를 수행해주세요.',
        requests: [{
          method: 'POST',
          url: 'https://ec2.amazonaws.com/test',
          action: 'TestAction',
          timestamp: new Date().toISOString(),
          requestBody: { test: true },
          type: 'xmlhttprequest',
          initiator: 'test'
        }]
      };
      
      Logger.info('수동 테스트 전송 시작', { 
        configUrl: CONFIG.EC2_URL,
        configLoaded,
        testDataSize: JSON.stringify(testData).length
      });
      
      sendToServer(testData).then(success => {
        Logger.info('테스트 전송 완료', { success });
      }).catch(error => {
        Logger.error('테스트 전송 오류', { error: error.message });
      });
      
      sendResponse({ success: true, message: '테스트 전송 시작됨' });
      return true;
      
    case 'fetchCloudTrailFailures':
      console.log('CloudTrail API 요청 수신, CONFIG.EC2_URL:', CONFIG.EC2_URL);
      
      if (!CONFIG.EC2_URL) {
        console.error('서버 URL 없음');
        sendResponse({ success: false, error: '서버 URL이 설정되지 않음' });
        return true;
      }
      
      const apiUrl = `${CONFIG.EC2_URL}/cloudtrail/failures`;
      console.log('CloudTrail API URL:', apiUrl);
      
      fetch(apiUrl, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Accept': 'application/json'
        }
      })
      .then(response => {
        console.log('CloudTrail API 응답 상태:', response.status, response.statusText);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('CloudTrail API 데이터:', data);
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('CloudTrail API 오류:', error);
        sendResponse({ success: false, error: error.message });
      });
      
      return true;
      
    case 'fetchProfile':
      if (!CONFIG.EC2_URL) {
        sendResponse({ success: false, error: '서버 URL 미설정' });
        return true;
      }
      
      const profileCheckUrl = CONFIG.EC2_URL.replace('https://', 'http://') + '/profile-check';
      
      fetch(profileCheckUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.text();
      })
      .then(data => {
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('프로파일 로드 실패:', error);
        sendResponse({ success: false, error: error.message });
      });
      
      return true;
      
    case 'sendProfile':
      if (!CONFIG.EC2_URL) {
        sendResponse({ success: false, error: '서버 URL 미설정' });
        return true;
      }
      
      const profileUrl = CONFIG.EC2_URL.replace('https://', 'http://') + '/profile';
      
      fetch(profileUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ profile: request.profile })
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.text();
      })
      .then(data => {
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('프로파일 전송 실패:', error);
        sendResponse({ success: false, error: error.message });
      });
      
      return true;
      
    default:
      return false;
  }
});