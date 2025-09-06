from flask import Flask, request, jsonify, make_response
import subprocess
import os
import json
import re
import logging

app = Flask(__name__)

# Flask 로깅 설정 (INFO 레벨로 변경하여 요청 로그 표시)
logging.getLogger('werkzeug').setLevel(logging.INFO)

# CORS 헤더를 after_request로 처리 (preflight 없이)
@app.after_request
def after_request(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Accept'
    return response

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = make_response()
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add('Access-Control-Allow-Headers', "*")
        response.headers.add('Access-Control-Allow-Methods', "*")
        return response

def clean_ansi_codes(text):
    """ANSI 색상 코드 및 개행문자 제거"""
    import re
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    text = ansi_escape.sub('', text)
    text = text.replace('\n', ' ').replace('\r', ' ')
    return text

# AWS 서비스 매핑
SERVICE_MAPPING = {
    'ec2': 'ec2.md',
    'eventbridge': 'eventbridge.md', 
    'events': 'eventbridge.md',
    'cloudwatch': 'cloudwatch.md',
    'logs': 'cloudwatch.md',
    'lambda': 'lambda.md',
    'ecs': 'ecs.md',
    'cloudtrail': 'cloudtrail.md',
    'iam': 'iam.md'
}

def detect_aws_service(query):
    """HTTP 요청에서 AWS 서비스 감지"""
    query_lower = query.lower()
    for service in SERVICE_MAPPING.keys():
        if service in query_lower:
            return service
    return None

def load_guideline(service):
    """서비스별 지침 로드"""
    if service not in SERVICE_MAPPING:
        return ""
    
    guideline_path = f"/home/ec2-user/amazonq-hackathon/guidelines/{SERVICE_MAPPING[service]}"
    try:
        with open(guideline_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return ""

def create_enhanced_query(original_query, service, guideline):
    """지침을 포함한 향상된 쿼리 생성"""
    # user-situation 파일에서 사용자 상황 읽기
    try:
        with open('user-situation', 'r', encoding='utf-8') as f:
            user_situation = f.read().strip()
        if not user_situation:
            user_situation = "제공되지 않음"
    except (FileNotFoundError, IOError):
        user_situation = "제공되지 않음"
    
    enhanced_query = f"""사용자 상황: {user_situation}

다음은 AWS {service.upper()} 서비스에 대한 HTTP 요청 분석입니다:

{original_query}

아래 지침을 참고하여 위 HTTP Request가 수행하고자 하는 활동이 뭔지 파악하고 해당 활동이 수행되었을 경우의 권고사항, 주의사항, 잠재적 문제점을 분석해 알려주세요:

{guideline}

특히 다음 사항들을 중점적으로 검토해주세요:
1. 보안 관련 권고사항
2. 해당 명령을 수행할 경우 사용되는 IAM 권한/역할/사용자의 파악과 적절한 권한이 부여되었는지 여부
2. 운영 시 주의사항
4. 인프라 아키텍처 동작 관련 잠재적 이슈(Console에서는 확인하기 힘든 점을 중점적으로)
5. 보안/기능성 측면에서 수행 난이도 측면에서 더 권고되는 사항
"""
    return enhanced_query

@app.route('/', methods=['GET', 'POST'])
def handle_request_test():
    if request.method == 'GET':
        return '''
        <!DOCTYPE html>
        <html>
        <head><title>Amazon Q Chat</title></head>
        <body style="font-family: Arial; margin: 20px;">
            <h2>Amazon Q Chat Interface</h2>
            <form method="post">
                <textarea name="query" placeholder="Enter your question for Amazon Q" 
                         rows="5" cols="80" style="width: 100%; padding: 10px;"></textarea><br><br>
                <input type="submit" value="Ask Amazon Q" style="padding: 10px 20px;">
            </form>
        </body>
        </html>
        '''
    
    query = request.form.get('query', '')
    if not query:
        return '<p>No query provided</p>'
    
    try:
        env = os.environ.copy()
        env['QUERY'] = query
        
        result = subprocess.run(['bash', '-c', 'echo "$QUERY" | q chat'], 
                              env=env, capture_output=True, text=True, timeout=30)
        
        response = result.stdout.replace('\n', '<br>')
        error = result.stderr.replace('\n', '<br>') if result.stderr else ''
        
        return f'''
        <!DOCTYPE html>
        <html>
        <head><title>Amazon Q Response</title></head>
        <body style="font-family: Arial; margin: 20px;">
            <h2>Amazon Q Response</h2>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
                <strong>Query:</strong> {query}
            </div>
            <div style="background: #e8f4fd; padding: 15px; border-radius: 5px; margin: 10px 0;">
                <strong>Response:</strong><br>{response}
            </div>
            {f'<div style="background: #ffe6e6; padding: 15px; border-radius: 5px; margin: 10px 0;"><strong>Error:</strong><br>{error}</div>' if error else ''}
            <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #007cba; color: white; text-decoration: none; border-radius: 5px;">Ask Another Question</a>
        </body>
        </html>
        '''
    except subprocess.TimeoutExpired:
        return '<p>Request timed out</p>'
    except Exception as e:
        return f'<p>Error: {str(e)}</p>'

@app.route('/api/ask', methods=['GET', 'POST'])
def api_ask():
    # securityMode GET 파라미터 확인
    security_mode = request.args.get('securityMode', 'false').lower() == 'true'
    agent_name = "Security-on-dev" if security_mode else "Security-off-dev"
    
    print(f"=== Security Mode: {security_mode}, Agent: {agent_name} ===")
    
    # raw body 가져오기
    if request.method == 'POST':
        if request.is_json:
            raw_body = json.dumps(request.get_json(), indent=2, ensure_ascii=False)
            print("=== /api/ask POST Request Body (JSON) ===")
            print(raw_body)
        else:
            raw_body = request.get_data(as_text=True)
            print("=== /api/ask POST Request Body (Text) ===")
            print(raw_body)
        print("=" * 50)
    else:
        raw_body = f"Query: {request.args.get('query', '')}"
        print("=== /api/ask GET Request ===")
        print(raw_body)
        print("=" * 50)
    
    if not raw_body.strip():
        return "Error: No body provided", 400
    
    try:
        # 1단계: raw body만 전달하여 READ/WRITE/EXECUTE 판정
        env = os.environ.copy()
        env['QUERY'] = raw_body
        
        level1_result = subprocess.run(['bash', '-c', 'echo "$QUERY" | timeout 120 q chat --agent checkAction --no-interactive --trust-all-tools 2>/dev/null'], 
                                    env=env, capture_output=True, text=True, timeout=120)
        
        print("=== Level1 Amazon Q Response ===")
        print(f"Return code: {level1_result.returncode}")
        print(f"Stdout: {level1_result.stdout}")
        print(f"Stderr: {level1_result.stderr}")
        print("=" * 50)
        
        if level1_result.stderr:
            print(f"=== Level1 Amazon Q Error ===")
            print(f"Error: {level1_result.stderr}")
            print("=" * 50)
            return f"Error: {level1_result.stderr}", 500
        
        level1_response = level1_result.stdout
        
        # &&& 사이의 내용 추출 (READ/WRITE/EXECUTE 판정)
        action_match = re.search(r'&&&(.*?)&&&', level1_response, re.DOTALL)
        if action_match:
            action_text = action_match.group(1).strip().upper()
            print(f"=== Level1 Action Detection ===")
            print(f"Action: {action_text}")
            print("=" * 50)
            
            if action_text == 'READ':
                print("Level1 AmazonQ에서 Read라 판정.")
                return '', 204
        else:
            print(f"=== Level1 Action Detection Failed ===")
            print(f"No &&& pattern found in response: {level1_response}")
            print("=" * 50)
        
        # 2단계: READ가 아닐 경우에만 상세 분석 수행
        # AWS 서비스 감지 및 지침 로드
        detected_service = detect_aws_service(raw_body)
        guideline = ""
        
        if detected_service:
            guideline = load_guideline(detected_service)
        
        # 고정된 쿼리 형식 사용
        enhanced_query = create_enhanced_query(raw_body, detected_service or 'UNKNOWN', guideline)
        
        env['QUERY'] = enhanced_query
        
        result = subprocess.run(['bash', '-c', f'echo "$QUERY" | timeout 120 q chat --agent {agent_name} --no-interactive --trust-all-tools 2>/dev/null'], 
                              env=env, capture_output=True, text=True, timeout=120)
        
        print("=== Level2 Amazon Q Raw Response ===")
        print(f"Return code: {result.returncode}")
        print(f"Stdout length: {len(result.stdout)} characters")
        print(f"Stderr length: {len(result.stderr)} characters")
        if result.stdout:
            print(f"Full stdout:\n{result.stdout}")
        else:
            print("No stdout output")
        if result.stderr:
            print(f"Full stderr:\n{result.stderr}")
        else:
            print("No stderr output")
        print("=" * 50)
        
        if result.stderr:
            print(f"=== Level2 Amazon Q Error ===")
            print(f"Error: {result.stderr}")
            print("=" * 50)
            return f"Error: {result.stderr}", 500
        
        response_text = result.stdout
        
        # %%% 사이의 내용 추출
        recommand_match = re.search(r'%%%(.*?)%%%', response_text, re.DOTALL)
        recommand_text = ""
        if recommand_match:
            recommand_text = recommand_match.group(1).strip()
            print(f"=== Found %%% Content ===")
            print(f"Recommand: {recommand_text}")
            print("=" * 50)

        # @@@ 사이의 내용 추출
        summary_match = re.search(r'@@@(.*?)@@@', response_text, re.DOTALL)
        summary_text = ""
        if summary_match:
            summary_text = summary_match.group(1).strip()
            print(f"=== Found @@@ Content ===")
            print(f"Summary: {summary_text}")
            print("=" * 50)
        
        # +++ 사이의 내용 추출 (더 유연한 패턴)
        detail_match = re.search(r'\+\+\+([^+]*?)\+\+\+', response_text, re.DOTALL)
        detail_text = ""
        if detail_match:
            detail_text = detail_match.group(1).strip()
            print(f"=== Found +++ Content ===")
            print(f"Detail: {detail_text}")
            print("=" * 50)
        
        # ^^^ 사이의 내용 추출 (Action)
        action_match = re.search(r'\^\^\^(.*?)\^\^\^', response_text, re.DOTALL)
        action_text = ""
        if action_match:
            action_text = action_match.group(1).strip()
            print(f"=== Found ^^^ Content ===")
            print(f"Action: {action_text}")
            print("=" * 50)
        
        # 최종 응답 구성 - 패턴이 있는 경우만 응답
        response_parts = []
        
        if recommand_text:
            response_parts.append(f"recommand: {clean_ansi_codes(recommand_text)}")
        if summary_text:
            response_parts.append(f"summary: {clean_ansi_codes(summary_text)}")
        if detail_text:
            response_parts.append(f"value: {clean_ansi_codes(detail_text)}")
        if action_text:
            response_parts.append(f"action: {clean_ansi_codes(action_text)}")
        
        if response_parts:
            response_text = "\n\n".join(response_parts)
        else:
            # 패턴이 없으면 에러 메시지 반환
            response_text = "Generated Response from AmazonQ Format Error"
        
        if detected_service:
            response_text = f"[AWS {detected_service.upper()} 서비스 분석]\n\n{response_text}"
        
        print("=== Amazon Q Response ===")
        print(f"Response length: {len(response_text)} characters")
        print(f"Full response: {response_text}")
        print("=" * 50)
        
        return response_text, 200, {'Content-Type': 'text/plain'}
        
    except subprocess.TimeoutExpired:
        print("=== Timeout Error ===")
        print("Request timed out after 120 seconds")
        print("=" * 50)
        return "Error: Request timed out", 408
    except Exception as e:
        print(f"=== Exception Error ===")
        print(f"Exception: {str(e)}")
        print("=" * 50)
        return f"Error: {str(e)}", 500
    # raw body 가져오기
    if request.method == 'POST':
        if request.is_json:
            raw_body = json.dumps(request.get_json(), indent=2, ensure_ascii=False)
            print("=== /api/ask POST Request Body (JSON) ===")
            print(raw_body)
        else:
            raw_body = request.get_data(as_text=True)
            print("=== /api/ask POST Request Body (Text) ===")
            print(raw_body)
        print("=" * 50)
    else:
        raw_body = f"Query: {request.args.get('query', '')}"
        print("=== /api/ask GET Request ===")
        print(raw_body)
        print("=" * 50)
    
    if not raw_body.strip():
        return "Error: No body provided", 400
    
    try:
        # 1단계: raw body만 전달하여 READ/WRITE/EXECUTE 판정
        env = os.environ.copy()
        env['QUERY'] = raw_body
        
        level1_result = subprocess.run(['bash', '-c', 'echo "$QUERY" | timeout 120 q chat --agent checkAction --no-interactive --trust-all-tools 2>/dev/null'], 
                                    env=env, capture_output=True, text=True, timeout=120)
        
        print("=== Level1 Amazon Q Response ===")
        print(f"Return code: {level1_result.returncode}")
        print(f"Stdout: {level1_result.stdout}")
        print(f"Stderr: {level1_result.stderr}")
        print("=" * 50)
        
        if level1_result.stderr:
            print(f"=== Level1 Amazon Q Error ===")
            print(f"Error: {level1_result.stderr}")
            print("=" * 50)
            return f"Error: {level1_result.stderr}", 500
        
        level1_response = level1_result.stdout
        
        # &&& 사이의 내용 추출 (READ/WRITE/EXECUTE 판정)
        action_match = re.search(r'&&&(.*?)&&&', level1_response, re.DOTALL)
        if action_match:
            action_text = action_match.group(1).strip().upper()
            print(f"=== Level1 Action Detection ===")
            print(f"Action: {action_text}")
            print("=" * 50)
            
            if action_text == 'READ':
                print("Level1 AmazonQ에서 Read라 판정.")
                return '', 204
        else:
            print(f"=== Level1 Action Detection Failed ===")
            print(f"No &&& pattern found in response: {level1_response}")
            print("=" * 50)
        
        # 2단계: READ가 아닐 경우에만 상세 분석 수행
        # AWS 서비스 감지 및 지침 로드
        detected_service = detect_aws_service(raw_body)
        guideline = ""
        
        if detected_service:
            guideline = load_guideline(detected_service)
        
        # 고정된 쿼리 형식 사용
        enhanced_query = create_enhanced_query(raw_body, detected_service or 'UNKNOWN', guideline)
        
        env['QUERY'] = enhanced_query
        
        result = subprocess.run(['bash', '-c', 'echo "$QUERY" | timeout 120 q chat --agent aws-copilot --no-interactive --trust-all-tools 2>/dev/null'], 
                              env=env, capture_output=True, text=True, timeout=120)
        
        print("=== Level2 Amazon Q Raw Response ===")
        print(f"Return code: {result.returncode}")
        print(f"Stdout length: {len(result.stdout)} characters")
        print(f"Stderr length: {len(result.stderr)} characters")
        if result.stdout:
            print(f"Full stdout:\n{result.stdout}")
        else:
            print("No stdout output")
        if result.stderr:
            print(f"Full stderr:\n{result.stderr}")
        else:
            print("No stderr output")
        print("=" * 50)
        
        if result.stderr:
            print(f"=== Level2 Amazon Q Error ===")
            print(f"Error: {result.stderr}")
            print("=" * 50)
            return f"Error: {result.stderr}", 500
        
        response_text = result.stdout
        
        # %%% 사이의 내용 추출
        recommand_match = re.search(r'%%%(.*?)%%%', response_text, re.DOTALL)
        recommand_text = ""
        if recommand_match:
            recommand_text = recommand_match.group(1).strip()
            print(f"=== Found %%% Content ===")
            print(f"Recommand: {recommand_text}...")
            print("=" * 50)

        # @@@ 사이의 내용 추출
        summary_match = re.search(r'@@@(.*?)@@@', response_text, re.DOTALL)
        summary_text = ""
        if summary_match:
            summary_text = summary_match.group(1).strip()
            print(f"=== Found @@@ Content ===")
            print(f"Summary: {summary_text}")
            print("=" * 50)
        
        # +++ 사이의 내용 추출 (더 유연한 패턴)
        detail_match = re.search(r'\+\+\+([^+]*?)\+\+\+', response_text, re.DOTALL)
        detail_text = ""
        if detail_match:
            detail_text = detail_match.group(1).strip()
            print(f"=== Found +++ Content ===")
            print(f"Detail: {detail_text}")
            print("=" * 50)
        
        # JSON 응답 구성
        response_data = {}
        
        if recommand_text:
            response_data['recommand'] = clean_ansi_codes(recommand_text)
        if summary_text:
            response_data['summary'] = clean_ansi_codes(summary_text)
        if detail_text:
            response_data['value'] = clean_ansi_codes(detail_text)
            
        # 패턴이 없으면 에러 메시지
        if not response_data:
            response_data = {"error": "Generated Response from AmazonQ Format Error"}
        
        # 서비스 정보 추가
        if detected_service:
            response_data['service'] = detected_service.upper()
        
        print("=== Amazon Q Response ===")
        print(f"Response data: {response_data}")
        print("=" * 50)
        
        #return jsonify(response_data)
        return "test:test"

    except subprocess.TimeoutExpired:
        print("=== Timeout Error ===")
        print("Request timed out after 120 seconds")
        print("=" * 50)
        return "Error: Request timed out", 408
    except Exception as e:
        print(f"=== Exception Error ===")
        print(f"Exception: {str(e)}")
        print("=" * 50)
        return f"Error: {str(e)}", 500

@app.route('/prompt', methods=['POST'])
def prompt():
    """Amazon Q에 직접 쿼리를 보내는 엔드포인트"""
    try:
        # POST 파라미터에서 query 가져오기
        if request.is_json:
            data = request.get_json()
            query = data.get('query', '') if data else ''
        else:
            query = request.form.get('query', '') or request.get_data(as_text=True)
        
        if not query.strip():
            return "Error: No query provided", 400
        
        # Amazon Q에 직접 전송
        env = os.environ.copy()
        env['QUERY'] = query
        
        result = subprocess.run(['bash', '-c', 'echo "$QUERY" | timeout 120 q chat --agent promptChatbot --no-interactive --trust-all-tools 2>/dev/null'], 
                              env=env, capture_output=True, text=True, timeout=120)
        
        if result.stderr:
            return f"Error: {result.stderr}", 500
        
        # ANSI 코드 제거 후 응답
        response_text = clean_ansi_codes(result.stdout)
        return response_text, 200, {'Content-Type': 'text/plain; charset=utf-8'}
        
    except subprocess.TimeoutExpired:
        return "Error: Request timed out", 408
    except Exception as e:
        return f"Error: {str(e)}", 500

@app.route('/profile-check', methods=['GET', 'POST'])
def get_profile():
    """사용자 커스텀 프로필 확인 - 파일에서 읽기"""
    try:
        with open('user-situation', 'r', encoding='utf-8') as f:
            profile_data = f.read().strip()
        
        if not profile_data:
            return '파일 읽어올 수 없거나 데이터가 없음', 200, {'Content-Type': 'text/plain; charset=utf-8'}
        
        return profile_data, 200, {'Content-Type': 'text/plain; charset=utf-8'}
    except (FileNotFoundError, IOError):
        return '파일 읽어올 수 없거나 데이터가 없음', 200, {'Content-Type': 'text/plain; charset=utf-8'}

@app.route('/profile', methods=['POST'])
def set_profile():
    """사용자 커스텀 프로필 설정 - 파일에 저장"""
    try:
        if request.is_json:
            data = request.get_json()
            profile_data = data.get('profile', '') if data else ''
        else:
            profile_data = request.get_data(as_text=True)
        
        # user-situation 파일에 저장
        with open('user-situation', 'w', encoding='utf-8') as f:
            f.write(profile_data)
        
        return f'Profile updated: {profile_data}', 200
    except Exception as e:
        return f'Error saving profile: {str(e)}', 500

@app.route('/errors', methods=['POST'])
def handle_error():
    """에러 메시지 body를 stdout으로 출력"""
    try:
        # JSON 데이터 시도
        if request.is_json:
            body = request.get_json()
            print(json.dumps(body, indent=2, ensure_ascii=False))
        else:
            # 텍스트 데이터
            body = request.get_data(as_text=True)
            print(body)
        
        return 'OK', 200
    except Exception as e:
        print(f"Error processing request: {e}")
        return 'Error', 500

@app.route('/api/detect-service', methods=['POST'])
def detect_service():
    """서비스 감지 테스트용 엔드포인트"""
    data = request.get_json()
    query = data.get('query', '') if data else ''
    
    if not query:
        return 'Error: No query provided', 400
    
    detected_service = detect_aws_service(query)
    guideline_available = detected_service and load_guideline(detected_service) != ""
    
    return f"Query: {query}\nDetected Service: {detected_service or 'UNKNOWN'}\nGuideline Available: {'Yes' if guideline_available else 'No'}\nAvailable Services: {', '.join(SERVICE_MAPPING.keys())}"

@app.route('/cloudtrail/failures', methods=['GET'])
def get_cloudtrail_failures():
    """CloudTrail 실패 이벤트 조회"""
    try:
        import boto3
        from datetime import datetime, timedelta
        
        hours = int(request.args.get('hours', 1))
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        
        cloudtrail = boto3.client('cloudtrail', region_name='us-east-1')
        
        response = cloudtrail.lookup_events(
            StartTime=start_time,
            EndTime=end_time,
            MaxResults=50
        )
        
        failed_events = []
        
        for event in response.get('Events', []):
            ct_event = json.loads(event['CloudTrailEvent'])
            
            if (event.get('ErrorCode') or 
                event.get('ErrorMessage') or
                ct_event.get('errorCode') or 
                ct_event.get('errorMessage') or
                'AccessDenied' in str(ct_event)):
                
                event_id = event.get('EventId')
                failed_events.append({
                    'ErrorCode': event.get('ErrorCode') or ct_event.get('errorCode'),
                    'ErrorMessage': event.get('ErrorMessage') or ct_event.get('errorMessage'),
                    'EventTime': event['EventTime'],
                    'URL': f'https://us-east-1.console.aws.amazon.com/cloudtrailv2/home?region=us-east-1#/events/{event_id}' if event_id else None
                })
        
        return jsonify({
            'count': len(failed_events),
            'events': failed_events
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
