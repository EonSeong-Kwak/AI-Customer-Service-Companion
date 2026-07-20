import asyncio
from app.agents.builder_agent import builder_agent

sample_doc = """
【业务规范】：个人借记卡大额转账限制
为了保障客户资金安全，防范电信网络诈骗，我行对个人借记卡非柜面转账业务做出如下调整：
1. 默认限额：新开立的借记卡，默认单日非柜面转账限额为 5000 元。
2. 提额申请：如果客户需要进行 5000 元以上的大额转账，必须由本人携带有效身份证件及借记卡，前往我行任意网点柜台办理“非柜面限额提升”业务。
3. 证明材料：提额时，若单日申请额度超过 5 万元，柜员需要求客户提供辅助证明材料，如：近半年的工资流水、购房/购车合同等。若无法提供，最高只能提升至单日 5 万元。
4. 特殊情况：如果是给本人名下的我行其他账户转账，不受此限额影响。
"""

def main():
    print("开始调用 BuilderAgent 进行解析...")
    try:
        result = builder_agent.extract_knowledge_nodes(sample_doc)
        print("解析成功！输出结果：")
        import json
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"解析失败: {e}")

if __name__ == "__main__":
    main()
