from pydantic_settings import BaseSettings

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

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
