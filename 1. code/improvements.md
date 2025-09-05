# Chrome Extension 개선 제안사항

## 1. 로컬 저장 비활성화 시 신뢰성 개선

### 현재 문제점
- 네트워크 실패 시 데이터 손실 가능성
- 순서 보장 부족

### 개선 방안
```javascript
// background.js에 추가할 큐 시스템
class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }
  
  async enqueue(data) {
    this.queue.push({ ...data, timestamp: Date.now() });
    if (!this.processing) {
      this.processQueue();
    }
  }
  
  async processQueue() {
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const success = await sendToServer(item);
      if (!success) {
        // 실패 시 큐 앞쪽에 다시 추가
        this.queue.unshift(item);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    this.processing = false;
  }
}
```

## 2. Amazon Q 분석을 위한 스키마 개선

### 현재 스키마
```javascript
{
  timestamp: "2024-01-01T00:00:00Z",
  method: "POST",
  url: "https://ec2.amazonaws.com/...",
  headers: {...},
  body: {...}
}
```

### 개선된 스키마
```javascript
{
  // 기본 정보
  timestamp: "2024-01-01T00:00:00Z",
  sessionId: "uuid-v4",
  
  // 요청 정보
  request: {
    method: "POST",
    url: "https://ec2.amazonaws.com/...",
    service: "ec2",
    action: "RunInstances",
    region: "us-east-1"
  },
  
  // 컨텍스트 정보
  context: {
    userAgent: "masked",
    tabUrl: "https://console.aws.amazon.com/ec2/",
    previousAction: "DescribeInstances"
  },
  
  // 분석용 메타데이터
  metadata: {
    riskLevel: "unknown",
    resourceType: "ec2-instance",
    costImpact: "medium"
  }
}
```

## 3. Chrome Web Store 정책 완전 준수

### 추가 필요사항

#### 개인정보 처리방침 페이지
```html
<!-- privacy-policy.html -->
<!DOCTYPE html>
<html>
<head>
  <title>개인정보 처리방침</title>
</head>
<body>
  <h1>AWS Cloud Pilot 개인정보 처리방침</h1>
  
  <h2>수집하는 정보</h2>
  <ul>
    <li>AWS Console API 요청 정보 (민감정보 제외)</li>
    <li>확장 프로그램 설정 정보</li>
  </ul>
  
  <h2>정보 사용 목적</h2>
  <ul>
    <li>AWS 보안 설정 분석 및 조언 제공</li>
    <li>서비스 개선</li>
  </ul>
  
  <h2>데이터 보호</h2>
  <ul>
    <li>모든 민감정보는 자동으로 마스킹됩니다</li>
    <li>HTTPS를 통한 암호화 전송</li>
    <li>로컬 저장 최소화</li>
  </ul>
</body>
</html>
```

#### 사용자 동의 개선
```javascript
// content.js에 추가
function showConsentDialog() {
  const dialog = document.createElement('div');
  dialog.innerHTML = `
    <div class="consent-overlay">
      <div class="consent-dialog">
        <h3>데이터 수집 동의</h3>
        <p>AWS Cloud Pilot이 보안 분석을 위해 다음 정보를 수집합니다:</p>
        <ul>
          <li>AWS Console API 요청 정보 (민감정보 제외)</li>
          <li>페이지 URL 및 사용 패턴</li>
        </ul>
        <p>모든 민감정보는 자동으로 마스킹되며, 수집된 데이터는 보안 조언 목적으로만 사용됩니다.</p>
        <div class="consent-buttons">
          <button id="consent-accept">동의</button>
          <button id="consent-decline">거부</button>
        </div>
        <a href="privacy-policy.html" target="_blank">개인정보 처리방침 보기</a>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
}
```

## 4. 보안 강화

### API 키 보안
```javascript
// popup.js 개선
async function encryptApiKey(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const cryptoKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data
  );
  
  return { encrypted, iv, key: cryptoKey };
}
```

### 요청 서명
```javascript
// background.js에 추가
async function signRequest(data, secretKey) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const messageData = encoder.encode(JSON.stringify(data));
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature));
}
```

## 5. 성능 최적화

### 배치 처리
```javascript
// background.js 개선
class BatchProcessor {
  constructor(batchSize = 10, flushInterval = 5000) {
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
    if (this.batch.length === 0) return;
    
    const batchData = [...this.batch];
    this.batch = [];
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    await sendToServer({ batch: batchData });
  }
}
```

## 6. 에러 처리 및 로깅

### 구조화된 로깅
```javascript
class Logger {
  static log(level, message, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
      extension: 'aws-security-assistant'
    };
    
    console[level](JSON.stringify(logEntry));
    
    // 에러는 서버로도 전송
    if (level === 'error') {
      this.sendErrorToServer(logEntry);
    }
  }
  
  static async sendErrorToServer(error) {
    try {
      await fetch(`${CONFIG.EC2_URL}/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(error)
      });
    } catch (e) {
      // 에러 전송 실패는 무시
    }
  }
}
```