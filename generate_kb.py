import json
import re

def parse_markdown_to_kb(md_file_path, json_file_path):
    with open(md_file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    kb_entries = []
    node_id_counter = 1
    
    # Match full QA blocks:
    # **Q1：...**
    # *   **RAG知识点**：...
    # *   **标准话术**：...
    
    pattern_full = re.compile(r'\*\*Q\d+：(.*?)\*\*\n\*   \*\*RAG知识点\*\*：(.*?)\n\*   \*\*标准话术\*\*：(.*?)(?=\n\n|\Z)', re.DOTALL)
    
    for match in pattern_full.finditer(content):
        question = match.group(1).strip()
        rag_info = match.group(2).strip()
        script_info = match.group(3).strip()
        
        # Extract keywords from the question and rag_info (naive approach if jieba is not used)
        # To avoid dependency issues, we can just split by non-word chars and keep length > 1
        words = re.findall(r'[\u4e00-\u9fa5]{2,}', question + " " + rag_info)
        # Deduplicate and keep top 5-6
        unique_words = list(dict.fromkeys(words))[:6]
        if not unique_words:
            unique_words = ["客服", "银行", "业务"]
            
        combined_content = f"【客户问题】{question}\n【RAG知识点】{rag_info}\n【标准话术】{script_info}"
        
        kb_entries.append({
            "node_id": f"kb_{node_id_counter:03d}",
            "keywords": unique_words,
            "content": combined_content
        })
        node_id_counter += 1

    # Match short QA blocks:
    # *   Q11：密码重置后多久生效？（A：立即生效）
    pattern_short = re.compile(r'\*   Q\d+：(.*?)[（(]A：(.*?)[）)]')
    for match in pattern_short.finditer(content):
        question = match.group(1).strip()
        answer = match.group(2).strip()
        
        words = re.findall(r'[\u4e00-\u9fa5]{2,}', question + " " + answer)
        unique_words = list(dict.fromkeys(words))[:6]
        if not unique_words:
            unique_words = ["客服", "银行", "业务"]
            
        combined_content = f"【客户问题】{question}\n【RAG知识点/解答】{answer}"
        
        kb_entries.append({
            "node_id": f"kb_{node_id_counter:03d}",
            "keywords": unique_words,
            "content": combined_content
        })
        node_id_counter += 1

    # Save to json
    with open(json_file_path, 'w', encoding='utf-8') as f:
        json.dump(kb_entries, f, ensure_ascii=False, indent=2)

    print(f"Successfully generated {len(kb_entries)} KB entries and saved to {json_file_path}")

if __name__ == "__main__":
    parse_markdown_to_kb("银行客服RAG知识库语料_100问.md", "backend/data/mock_kb.json")
