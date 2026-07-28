from pydantic_settings import BaseSettings
from pathlib import Path

# .env 位于项目根目录；使用绝对路径避免因启动时的工作目录不同（如 cd backend 后启动）而读取不到配置
_PROJECT_ROOT = Path(__file__).resolve().parents[3]

class Settings(BaseSettings):
    PROJECT_NAME: str = "智能客服陪练系统 v1.0"
    API_V1_STR: str = "/api/v1"
    
    # 数据库和缓存连接字符串 (切换为 MySQL)
    DATABASE_URL: str = "mysql+aiomysql://root:123456@127.0.0.1:3306/customer_service"
    REDIS_URL: str = "redis://127.0.0.1:6379/0"
    
    # 安全与鉴权
    SECRET_KEY: str = "YOUR_SUPER_SECRET_KEY_HERE_CHANGE_IN_PRODUCTION"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 天

    dashscope_api_key_enc: str = ""

    # Coze 智能体（动态模拟考试的客户角色扮演）
    COZE_API_TOKEN: str = ""
    COZE_BOT_ID: str = ""
    COZE_BASE_URL: str = "https://api.coze.cn"

    class Config:
        env_file = str(_PROJECT_ROOT / ".env")
        extra = "ignore"

settings = Settings()
