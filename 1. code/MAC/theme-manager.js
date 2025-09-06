/**
 * 테마 감지 및 아이콘 관리 (안전 버전)
 */

class ThemeManager {
  constructor() {
    this.currentTheme = 'light';
    this.observer = null;
    this.initialized = false;
    this.init();
  }
  
  init() {
    // 안전한 초기화
    this.safeInit();
  }
  
  safeInit() {
    try {
      // 시스템 테마 감지
      this.detectSystemTheme();
      
      // DOM 준비 상태 확인 후 AWS Console 테마 감지
      if (document.readyState === 'complete') {
        this.setupAwsThemeDetection();
      } else {
        let setupCalled = false;
        // amazonq-ignore-next-line
        const setupOnce = () => {
          if (!setupCalled) {
            setupCalled = true;
            setTimeout(() => this.setupAwsThemeDetection(), 1000);
          }
        };
        
        document.addEventListener('DOMContentLoaded', setupOnce);
        
        // 추가 안전장치
        if (document.readyState === 'interactive') {
          setupOnce();
        }
      }
      
      // 시스템 테마 변경 감지
      if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addListener(() => this.detectSystemTheme());
      }
      
    } catch (error) {
      console.warn('테마 매니저 초기화 실패:', error);
    }
  }
  
  setupAwsThemeDetection() {
    if (this.initialized) return;
    
    try {
      // amazonq-ignore-next-line
      this.detectAwsConsoleTheme();
      this.setupObserver();
      this.initialized = true;
    } catch (error) {
      console.warn('AWS 테마 감지 설정 실패:', error);
      // 재시도 카운터 추가
      this.retryCount = (this.retryCount || 0) + 1;
      if (this.retryCount < 3) {
        setTimeout(() => {
          if (!this.initialized) {
            this.setupAwsThemeDetection();
          }
        }, 3000);
      }
    }
  }
  
  detectSystemTheme() {
    try {
      const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.updateTheme(isDark ? 'dark' : 'light');
    } catch (error) {
      console.warn('시스템 테마 감지 실패:', error);
    }
  }
  
  detectAwsConsoleTheme() {
    try {
      if (!document.documentElement || !document.body) {
        return;
      }
      
      const isDarkMode = document.documentElement.classList.contains('awsui-dark-mode') ||
                        document.body.classList.contains('awsui-dark-mode') ||
                        document.querySelector('[data-theme="dark"]') !== null;
      
      this.updateTheme(isDarkMode ? 'dark' : 'light');
    } catch (error) {
      console.warn('테마 감지 실패:', error);
    }
  }
  
  setupObserver() {
    try {
      // 기존 observer 정리
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      
      // DOM 요소 존재 확인
      if (!document.documentElement || !document.body) {
        return;
      }
      
      // amazonq-ignore-next-line
      this.observer = new MutationObserver(() => {
        try {
          this.detectAwsConsoleTheme();
        } catch (error) {
          console.warn('MutationObserver 콜백 실패:', error);
        }
      });
      
      // 안전하게 observe 시작
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme']
      });
      
      this.observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'data-theme']
      });
      
    } catch (error) {
      console.warn('MutationObserver 설정 실패:', error);
    }
  }
  
  updateTheme(theme) {
    if (this.currentTheme === theme) return;
    
    this.currentTheme = theme;
    
    try {
      // 백그라운드 스크립트에 테마 변경 알림
      chrome.runtime.sendMessage({
        action: 'themeChanged',
        theme: theme
      });
      
      // 플로팅 버튼 아이콘 업데이트
      this.updateFloatingButtonIcon(theme);
    } catch (error) {
      // amazonq-ignore-next-line
      console.warn('테마 업데이트 실패:', error);
    }
  }
  
  updateFloatingButtonIcon(theme) {
    try {
      const button = document.getElementById('aws-security-button');
      if (button) {
        // CSS 클래스 사용으로 성능 개선
        button.className = `aws-security-button theme-${theme}`;
        
        // 폴백으로 직접 스타일 적용
        if (theme === 'dark') {
          button.style.cssText += 'background: #ffffff !important; color: #232f3e !important; border: 2px solid #232f3e !important;';
        } else {
          button.style.cssText += 'background: #232f3e !important; color: white !important; border: none !important;';
        }
      }
    } catch (error) {
      console.warn('버튼 아이콘 업데이트 실패:', error);
    }
  }
  
  getCurrentTheme() {
    return this.currentTheme;
  }
  
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.initialized = false;
  }
}

// 안전한 전역 인스턴스 생성
try {
  if (!window.themeManager) {
    window.themeManager = new ThemeManager();
  }
} catch (error) {
  console.warn('테마 매니저 생성 실패:', error);
}