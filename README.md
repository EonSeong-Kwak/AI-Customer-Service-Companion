# 智能客服陪练系统

> 基于 LLM + RAG + 知识图谱的银行客服培训平台

## 项目简介

智能客服陪练系统是一套面向银行客服培训场景的智能化平台，结合大语言模型（LLM）、向量检索（RAG）、知识图谱与项目制学习（PBL），实现学员练习 → 错题分析 → 反向训练 → 模拟考试 → 能力画像的闭环训练流程。

## 核心功能

- **学习大厅**：银行业务知识库问答（RAG）、费曼复述、番茄钟
- **练习中心**：按业务线分类的题目练习、教学题型、反向训练（错题变种）
- **理论考试**：管理员组卷、发卷、学员作答、详情查看
- **情景模拟**：动态模拟考试，客户人格 + 烦躁值机制 + PBL 项目制
- **管理后台**：用户/题库/人格/知识库/知识图谱/项目场景/数据大屏管理

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19 + Ant Design 6 + Vite 8 |
| 后端 | Python 3.12 + FastAPI + SQLAlchemy 2.0 |
| 数据库 | MySQL 8.x（生产） |
| 向量库 | ChromaDB（离线模式） |
| LLM | 阿里云百炼 · DeepSeek 系列 |

## 快速开始

详见 [部署说明书](docs/部署说明书.md)

### 1. 克隆项目

```bash
git clone https://github.com/你的用户名/智能客服陪练.git
cd 智能客服陪练
```

### 2. 安装依赖

```bash
# 后端
python3.12 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# 前端
cd frontend
npm install
cd ..
```

### 3. 初始化数据库

```bash
# 确保 MySQL 已启动，并创建 customer_service 数据库
source venv/bin/activate
cd backend && python init_db.py && cd ..
```

### 4. 启动服务

```bash
chmod +x start_prod.sh
./start_prod.sh
```

访问：
- 前端：http://localhost:5173/
- 后端文档：http://localhost:8000/docs

## 文档

- [部署说明书](docs/部署说明书.md)
- [系统设计方案 v4.0](docs/系统设计方案_v4.0.md)
- [技术方案](docs/技术方案.md)

## 许可证

MIT License

## 作者

智能客服陪练系统开发团队