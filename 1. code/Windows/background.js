/**
 * AWS Cloud Pilot - Background Service Worker
 * AWS Console 트래픽을 모니터링하고 보안 분석을 위해 데이터를 전송
 */

// 구조화된 로깅 시스템
class Logger {
  static log(level, message, data = {}) {
    try {
      const sanitizedData = this.sanitizeData(data);
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        data: sanitizedData,
        extension: 'aws-security-assistant',
        version: '1.0.0'
      };
      
      const logMethods = { error: 'error', warn: 'warn' };
      const logMethod = logMethods[level] || 'log';
      console[logMethod](
        `[${level.toUpperCase()}] ${message}`,
        sanitizedData
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
      error: data.message || data.toString(), 
      stack: data.stack,
      name: data.name || 'Error'
    };
    if (typeof data === 'object') {
      try {
        // 순환 참조 방지를 위한 안전한 직렬화
        const seen = new WeakSet();
        const result = JSON.parse(JSON.stringify(data, (key, val) => {
          if (val != null && typeof val === 'object') {
            if (seen.has(val)) return '[Circular]';
            seen.add(val);
          }
          // Error 객체 특별 처리
          if (val instanceof Error) {
            return {
              message: val.message || val.toString(),
              name: val.name || 'Error',
              stack: val.stack
            };
          }
          return val;
        }));
        
        return result;
      } catch (e) {
        // JSON 직렬화 실패 시 객체의 키-값을 안전하게 추출
        try {
          const safeObj = {};
          for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'function') {
              safeObj[key] = '[Function]';
            } else if (value === null) {
              safeObj[key] = null;
            } else if (value === undefined) {
              safeObj[key] = undefined;
            } else {
              safeObj[key] = String(value);
            }
          }
          return safeObj;
        } catch (e2) {
          return { error: 'Object serialization failed', originalError: e.message };
        }
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
  TEST_MODE: false, // 테스트 모드 비활성화
  SECURITY_MODE: false // 보안 모드 기본값 false
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
      Logger.error('BatchProcessor flush 실패', { error: error.message, batchSize: batchData.length });
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
    
    // Chrome Storage API 안전성 검사
    if (!chrome.storage || !chrome.storage.sync) {
      throw new Error('Chrome Storage API를 사용할 수 없습니다');
    }
    
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
        Logger.warn('EC2 URL 형식 오류', { 
          url: CONFIG.EC2_URL, 
          error: urlError.message || urlError.toString() 
        });
      }
    }
    
  } catch (error) {
    const errorMsg = error.message || error.toString() || '알 수 없는 오류';
    const errorStack = error.stack || 'Stack trace 없음';
    
    Logger.error('설정 로드 실패', { 
      errorMessage: errorMsg,
      errorStack: errorStack,
      errorName: error.name || 'Error',
      chromeStorageAvailable: !!(chrome.storage && chrome.storage.sync)
    });
    configLoaded = true; // 실패해도 로드 완료로 표시
  }
}

/**
 * 서버 응답을 두 개의 메시지로 분할하여 포맷 (Windows 호환성 개선)
 */
function formatServerResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    console.log('formatServerResponse: 빈 응답 또는 비문자열', { responseText });
    return [responseText || '빈 응답'];
  }
  
  try {
    // Windows에서 문자열 처리 개선
    let cleanedText = responseText.toString().replace(/^>\s*/, '').trim();
    
    // 빈 문자열 처리
    if (!cleanedText) {
      console.log('formatServerResponse: 청소 후 빈 문자열');
      return ['빈 응답을 받았습니다.'];
    }
    
    // Windows에서 정규식 처리 개선
    const threatMatch = cleanedText.match(/(?:value|threat):\s*([^\n\r]+)/gi);
    const summaryMatch = cleanedText.match(/summary:\s*([^\n\r]+)/gi);
    const recommendMatch = cleanedText.match(/(?:recommand|recommend):\s*([^\n\r]+)/gi);
    const actionMatch = cleanedText.match(/(?:action):\s*([^\n\r]+)/gi);
    const titleMatch = cleanedText.match(/\[([^\]]+)\]/);
    
    console.log('formatServerResponse 매칭 결과:', {
      threatMatch: !!threatMatch,
      summaryMatch: !!summaryMatch,
      recommendMatch: !!recommendMatch,
      actionMatch: !!actionMatch,
      titleMatch: !!titleMatch
    });
    
    if (!threatMatch && !summaryMatch && !recommendMatch && !actionMatch) {
      console.log('formatServerResponse: 특별 패턴 없음, 원본 반환');
      return [cleanedText];
    }
    
    // 첫 번째 메시지: Action, Summary, Recommend
    let firstMessage = '';
    
    // 제목 추가
    if (titleMatch) {
      firstMessage += `${titleMatch[0]}\n\n`;
    }
    
    // 1. Action
    if (actionMatch) {
      const action = actionMatch[0].replace(/(?:action):/gi, 'Action:');
      firstMessage += `⚙️ ${action}\n\n`;
    }
    
    // 2. Summary
    if (summaryMatch) {
      const summary = summaryMatch[0].replace(/summary:/gi, 'Summary:');
      firstMessage += `📋 ${summary}\n\n`;
    }
    
    // 3. Recommend
    if (recommendMatch) {
      const recommend = recommendMatch[0].replace(/(?:recommand|recommend):/gi, 'Recommend:');
      firstMessage += `💡 ${recommend}`;
    }
    
    // Threat 값에 따른 배경색과 테두리색 결정
    let backgroundColor = '#e8f5e8'; // 기본 초록
    let borderColor = '#4caf50'; // 기본 초록 테두리
    
    if (threatMatch && threatMatch.length > 0) {
      const threatValue = threatMatch[0].replace(/(?:value|threat):\s*/gi, '').trim();
      console.log('Threat 값 분석:', threatValue);
      
      if (threatValue.includes('인프라에러확실')) {
        backgroundColor = '#ffe8e8';
        borderColor = '#f44336';
      } else if (threatValue.includes('잠재인프라에러')) {
        backgroundColor = '#fff8e1';
        borderColor = '#ff9800';
      } else if (threatValue.includes('보안권고')) {
        backgroundColor = '#e8f0ff';
        borderColor = '#2196f3';
      }
    }
    
    const result = [];
    
    // 첫 번째 메시지
    if (firstMessage.trim()) {
      result.push({
        text: firstMessage.trim(),
        backgroundColor: backgroundColor,
        borderColor: borderColor
      });
    }
    
    // 두 번째 메시지: Threat
    if (threatMatch && threatMatch.length > 0) {
      const threatText = threatMatch[0].replace(/(?:value|threat):/gi, 'Value:');
      result.push({
        text: `🚨 ${threatText}`,
        backgroundColor: backgroundColor,
        borderColor: borderColor
      });
    }
    
    console.log('formatServerResponse 결과:', { resultCount: result.length });
    return result.length > 0 ? result : [cleanedText];
    
  } catch (error) {
    console.error('formatServerResponse 오류:', error);
    Logger.error('응답 포맷 변경 실패', { error: error.message, responseText: responseText?.substring(0, 100) });
    return [responseText?.replace(/^>\s*/, '').trim() || '응답 처리 오류'];
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
 * POST 요청으로 데이터 전송 (Windows 호환성 개선)
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
    
    let serverUrl = CONFIG.EC2_URL;
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = 'http://' + serverUrl;
    }
    
    // securityMode 파라미터 추가
    const url = new URL(`${serverUrl}/api/ask`);
    url.searchParams.set('securityMode', CONFIG.SECURITY_MODE.toString());

    // Windows 호환성을 위한 AbortController 사용
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/plain, application/json, */*',
        'Cache-Control': 'no-cache',
        'User-Agent': navigator.userAgent
      },
      body: jsonData,
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    Logger.info('서버 응답 상태', { 
      status: response.status, 
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      platform: navigator.platform
    });

    // 204 No Content 처리
    if (response.status === 204) {
      return true;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Windows에서 응답 처리 개선
    let responseData;
    const contentType = response.headers.get('content-type') || '';
    
    try {
      if (contentType.includes('application/json')) {
        const jsonResponse = await response.json();
        responseData = typeof jsonResponse === 'string' ? jsonResponse : JSON.stringify(jsonResponse);
      } else {
        responseData = await response.text();
      }
    } catch (parseError) {
      Logger.warn('응답 파싱 실패, 텍스트로 재시도', { parseError: parseError.message });
      responseData = await response.text();
    }
    
    console.log('서버 응답 데이터 수신:', {
      dataLength: responseData?.length || 0,
      dataPreview: responseData?.substring(0, 200) || 'empty',
      platform: navigator.platform,
      contentType: contentType
    });
    
    if (!responseData || responseData.trim() === '') {
      Logger.warn('빈 응답 수신');
      sendChatMessage('bot', '📥 서버에서 빈 응답을 받았습니다.');
      return true;
    }
    
    const formattedResponses = formatServerResponse(responseData);
    console.log('포맷된 응답 수:', formattedResponses.length);
    
    // Windows에서 메시지 전송 지연 추가
    for (let i = 0; i < formattedResponses.length; i++) {
      const message = formattedResponses[i];
      console.log(`메시지 ${i + 1} 전송:`, typeof message === 'string' ? message.substring(0, 50) : message.text?.substring(0, 50));
      
      if (typeof message === 'string') {
        sendChatMessage('bot', message);
      } else if (message && message.text) {
        sendChatMessage('bot', message.text, message.backgroundColor, message.borderColor);
      }
      
      // Windows에서 메시지 간 지연
      if (i < formattedResponses.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    Logger.info('서버 전송 성공', { 
      dataSize: jsonData.length, 
      responseStatus: response.status,
      responseLength: responseData?.length || 0,
      platform: navigator.platform
    });
    
    return true;
    
  } catch (error) {
    Logger.error('서버 전송 실패', {
      error: error.message,
      errorName: error.name,
      errorStack: error.stack,
      url: CONFIG.EC2_URL,
      retryCount,
      dataType: data?.type,
      platform: navigator.platform,
      userAgent: navigator.userAgent.substring(0, 100)
    });
    
    // Windows 전용 에러 처리
    if (error.name === 'AbortError') {
      sendChatMessage('bot', `⏱️ 요청 시간 초과: 서버 응답이 30초를 초과했습니다.`);
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      sendChatMessage('bot', `⚠️ 네트워크 연결 오류: 서버 URL을 확인해주세요 (${CONFIG.EC2_URL})`);
    } else if (error.message.includes('CORS')) {
      sendChatMessage('bot', `⚠️ CORS 오류: 서버에서 CORS 설정을 확인해주세요`);
    } else {
      sendChatMessage('bot', `❌ 서버 통신 오류: ${error.message}`);
    }
    
    // 재시도 로직
    if (retryCount < CONFIG.MAX_RETRY_COUNT) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY_MS * (retryCount + 1)));
      return sendToServer(data, retryCount + 1);
    }
    
    return false;
  }
}

/**
 * 채팅 메시지 전송 (Windows 호환성 개선)
 */
function sendChatMessage(sender, message, backgroundColor = null, borderColor = null) {
  console.log('sendChatMessage 호출:', { sender, messageLength: message.length, platform: navigator.platform });
  
  // 모든 AWS Console 탭에 메시지 전송
  chrome.tabs.query(
    { url: ['*://*.console.aws.amazon.com/*', '*://*.amazonaws.com/*'] },
    (tabs) => {
      console.log('찾은 탭 수:', tabs.length);
      let messageDelivered = false;
      let completedTabs = 0;
      
      if (tabs.length === 0) {
        console.log('탭이 없음 - 알림 저장');
        if (sender === 'bot') {
          saveUnreadNotification(message, backgroundColor, borderColor);
        }
        return;
      }
      
      // Windows에서 메시지 전송 지연 추가
      tabs.forEach((tab, index) => {
        setTimeout(() => {
          console.log('탭에 메시지 전송 시도:', tab.id);
          
          // Windows에서 안정성을 위한 에러 처리 강화
          try {
            chrome.tabs.sendMessage(tab.id, {
              action: 'addChatMessage',
              sender: sender,
              message: message,
              backgroundColor: backgroundColor,
              borderColor: borderColor,
              timestamp: new Date().toISOString(),
              platform: navigator.platform
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.log('메시지 전송 실패 (runtime error):', chrome.runtime.lastError.message);
              } else {
                console.log('메시지 전송 성공:', response);
                if (response && response.success) {
                  messageDelivered = true;
                }
              }
              
              completedTabs++;
              console.log(`완료된 탭: ${completedTabs}/${tabs.length}, 전송성공: ${messageDelivered}`);
              
              // 모든 탭 처리 완료 후 체크
              if (completedTabs === tabs.length && !messageDelivered && sender === 'bot') {
                console.log('모든 탭 전송 실패 - 알림 저장');
                saveUnreadNotification(message, backgroundColor, borderColor);
              }
            });
          } catch (error) {
            console.error('메시지 전송 예외:', error);
            completedTabs++;
            if (completedTabs === tabs.length && !messageDelivered && sender === 'bot') {
              saveUnreadNotification(message, backgroundColor, borderColor);
            }
          }
        }, index * 50); // Windows에서 탭별 지연 추가
      });
    }
  );
}

/**
 * 읽지 않은 알림 저장 (background에서)
 */
function saveUnreadNotification(message, backgroundColor = null, borderColor = null) {
  console.log('saveUnreadNotification 호출:', message.substring(0, 50));
  chrome.storage.local.get(['aws-unread-notifications'], (result) => {
    const unread = result['aws-unread-notifications'] || [];
    console.log('기존 알림 수:', unread.length);
    unread.push({ message, backgroundColor, borderColor, timestamp: Date.now() });
    console.log('새 알림 추가 후 수:', unread.length);
    
    chrome.storage.local.set({ 'aws-unread-notifications': unread }, () => {
      console.log('알림 저장 완료');
      

    });
  });
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
    
    // 윈도우 호환성을 위해 배치 처리 대신 즉시 전송
    console.log('AWS 요청 감지, 즉시 서버 전송:', {
      method: details.method,
      url: details.url.substring(0, 100),
      action: action
    });
    
    sendToServer({
      type: 'single',
      request: requestData,
      timestamp: new Date().toISOString()
    }).then(success => {
      console.log('AWS 요청 전송 결과:', success);
    }).catch(error => {
      console.error('AWS 요청 전송 실패:', error);
    });
    
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
      
    case 'sendPrompt':
      if (!CONFIG.EC2_URL) {
        sendResponse({ success: false, error: '서버 URL 미설정' });
        return true;
      }
      
      let promptUrl = CONFIG.EC2_URL;
      if (!promptUrl.startsWith('http://') && !promptUrl.startsWith('https://')) {
        promptUrl = 'http://' + promptUrl;
      }
      
      // Windows 호환성을 위한 AbortController 사용
      const promptController = new AbortController();
      const promptTimeoutId = setTimeout(() => promptController.abort(), 30000);
      
      fetch(`${promptUrl}/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/plain, application/json, */*',
          'Cache-Control': 'no-cache',
          'User-Agent': navigator.userAgent
        },
        body: JSON.stringify({ query: request.query }),
        mode: 'cors',
        credentials: 'omit',
        signal: promptController.signal
      })
      .then(response => {
        clearTimeout(promptTimeoutId);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // Windows에서 응답 처리 개선
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return response.json().then(json => 
            typeof json === 'string' ? json : JSON.stringify(json)
          ).catch(() => response.text());
        } else {
          return response.text();
        }
      })
      .then(async (data) => {
        // 로딩 메시지 제거
        chrome.tabs.query(
          { url: ['*://*.console.aws.amazon.com/*', '*://*.amazonaws.com/*'] },
          (tabs) => {
            tabs.forEach(tab => {
              chrome.tabs.sendMessage(tab.id, {
                action: 'removeLoadingMessage',
                loadingId: request.loadingId
              }).catch(() => {});
            });
          }
        );
        
        // 응답 포맷 변경 후 표시
        if (data && data.trim()) {
          const formattedResponses = formatServerResponse(data.trim());
          
          // Windows에서 메시지 전송 지연 추가
          for (let i = 0; i < formattedResponses.length; i++) {
            const message = formattedResponses[i];
            if (typeof message === 'string') {
              sendChatMessage('bot', message);
            } else if (message && message.text) {
              sendChatMessage('bot', message.text, message.backgroundColor, message.borderColor);
            }
            
            if (i < formattedResponses.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        } else {
          sendChatMessage('bot', '📥 서버에서 빈 응답을 받았습니다.');
        }
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        clearTimeout(promptTimeoutId);
        
        // 로딩 메시지 제거
        chrome.tabs.query(
          { url: ['*://*.console.aws.amazon.com/*', '*://*.amazonaws.com/*'] },
          (tabs) => {
            tabs.forEach(tab => {
              chrome.tabs.sendMessage(tab.id, {
                action: 'removeLoadingMessage',
                loadingId: request.loadingId
              }).catch(() => {});
            });
          }
        );
        
        console.error('프롬프트 전송 실패:', error);
        let errorMessage = error.message;
        if (error.name === 'AbortError') {
          errorMessage = '요청 시간 초과 (30초)';
        }
        sendChatMessage('bot', `❌ 오류: ${errorMessage}`);
        sendResponse({ success: false, error: errorMessage });
      });
      
      return true;
      
    case 'setSecurityMode':
      CONFIG.SECURITY_MODE = request.securityMode;
      console.log('보안 모드 변경:', CONFIG.SECURITY_MODE);
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
        credentials: 'omit',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        },
        timeout: 15000
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
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        },
        timeout: 15000
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
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({ profile: request.profile }),
        timeout: 15000
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