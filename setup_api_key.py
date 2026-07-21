#!/usr/bin/env python3
"""
API Key 配置脚本
帮助用户快速配置阿里云百炼 API Key
"""
import os
import sys
from pathlib import Path
from cryptography.fernet import Fernet

def main():
    print("=" * 60)
    print("智能客服陪练系统 - API Key 配置向导")
    print("=" * 60)
    print()
    
    # 1. 检查是否已有配置
    project_root = Path(__file__).parent
    secrets_key_path = project_root / ".secrets.key"
    env_path = project_root / ".env"
    
    if secrets_key_path.exists() and env_path.exists():
        print("✅ 检测到已有配置文件：")
        print(f"   - .secrets.key ({secrets_key_path.stat().st_size} bytes)")
        print(f"   - .env")
        print()
        choice = input("是否重新配置？(y/N): ").strip().lower()
        if choice != 'y':
            print("退出配置。")
            return
    
    # 2. 引导用户获取 API Key
    print("📝 步骤 1: 获取阿里云百炼 API Key")
    print("-" * 60)
    print("1. 打开阿里云百炼平台: https://bailian.console.aliyun.com/")
    print("2. 登录阿里云账号")
    print("3. 在「API-KEY 管理」中创建新的 API Key")
    print("4. 复制生成的 API Key（只显示一次，请妥善保存）")
    print()
    
    # 3. 输入 API Key
    print("📝 步骤 2: 输入你的 API Key")
    print("-" * 60)
    api_key = input("请粘贴你的阿里云百炼 API Key: ").strip()
    
    if not api_key:
        print("❌ API Key 不能为空")
        return
    
    if not api_key.startswith("sk-"):
        print("⚠️  警告: API Key 通常以 'sk-' 开头，请确认是否正确")
        choice = input("继续配置？(y/N): ").strip().lower()
        if choice != 'y':
            return
    
    # 4. 生成加密密钥
    print()
    print("📝 步骤 3: 生成加密密钥")
    print("-" * 60)
    encryption_key = Fernet.generate_key()
    print(f"✅ 已生成加密密钥 ({len(encryption_key)} bytes)")
    
    # 5. 加密 API Key
    fernet = Fernet(encryption_key)
    encrypted_api_key = fernet.encrypt(api_key.encode()).decode()
    print(f"✅ 已加密 API Key")
    
    # 6. 保存配置文件
    print()
    print("📝 步骤 4: 保存配置文件")
    print("-" * 60)
    
    # 保存加密密钥
    with open(secrets_key_path, 'wb') as f:
        f.write(encryption_key)
    print(f"✅ 已保存加密密钥到: {secrets_key_path}")
    
    # 保存环境变量
    env_content = f"""# 阿里云百炼 API Key（加密存储）
DASHSCOPE_API_KEY_ENC='{encrypted_api_key}'

# 数据库连接字符串（默认 SQLite，生产环境请改为 MySQL）
# DATABASE_URL=mysql+aiomysql://用户名:密码@主机:端口/customer_service
DATABASE_URL=sqlite+aiosql:///./backend/local.db

# JWT 密钥（生产环境必须修改）
SECRET_KEY=CHANGE_THIS_IN_PRODUCTION_PLEASE

# JWT 过期时间（分钟）
ACCESS_TOKEN_EXPIRE_MINUTES=10080
"""
    
    with open(env_path, 'w', encoding='utf-8') as f:
        f.write(env_content)
    print(f"✅ 已保存环境变量到: {env_path}")
    
    # 7. 提示
    print()
    print("=" * 60)
    print("🎉 配置完成！")
    print("=" * 60)
    print()
    print("接下来请执行：")
    print("1. 安装依赖:")
    print("   source venv/bin/activate")
    print("   pip install -r backend/requirements.txt")
    print()
    print("2. 初始化数据库:")
    print("   cd backend && python init_db.py && cd ..")
    print()
    print("3. 启动服务:")
    print("   ./start_prod.sh")
    print()
    print("⚠️  注意事项:")
    print("- .secrets.key 和 .env 已被 .gitignore 排除，不会被上传到 Git")
    print("- 请妥善保管你的 API Key，不要分享给他人")
    print("- 生产环境请修改 .env 中的 SECRET_KEY 和数据库连接")
    print()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n配置已取消。")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 配置失败: {e}")
        sys.exit(1)