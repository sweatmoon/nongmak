FROM python:3.11-slim

# 한글 폰트 설치 (PDF 생성용)
RUN apt-get update && apt-get install -y \
    fonts-nanum \
    fonts-nanum-extra \
    fontconfig \
    && fc-cache -fv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 먼저 복사 (캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 앱 소스 복사
COPY . .

# out 디렉토리 생성
RUN mkdir -p out

# 시작 스크립트 실행 권한
RUN chmod +x start.sh

EXPOSE 8000

CMD ["/bin/sh", "start.sh"]
