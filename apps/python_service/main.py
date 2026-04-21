from fastapi import FastAPI, UploadFile, File, HTTPException, Form
import uvicorn
import fitz  # PyMuPDF
from bs4 import BeautifulSoup
import requests
import io
import chromadb
from langchain_text_splitters import RecursiveCharacterTextSplitter
import uuid
import os

app = FastAPI(title="Lex Tigress - Python RAG Microservice")

# Initialize ChromaDB persistent client
os.makedirs("./chroma_db", exist_ok=True)
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection(name="legal_docs")

@app.post("/extract-text")
async def extract_text(file: UploadFile = File(...), session_id: str = Form(None)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    try:
        content = await file.read()
        doc = fitz.open(stream=content, filetype="pdf")
        
        full_text = ""
        chunks = []
        
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )

        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text("text") or ""
            full_text += text + "\n"
            
            # Create chunks for RAG
            page_chunks = text_splitter.split_text(text)
            for i, chunk in enumerate(page_chunks):
                chunk_id = f"{session_id or str(uuid.uuid4())}-p{page_num}-c{i}"
                chunks.append({
                    "id": chunk_id,
                    "text": chunk,
                    "metadata": {"page": page_num + 1, "source": file.filename, "session_id": session_id or "global"}
                })

        # Add to ChromaDB Vector DB
        if chunks:
            collection.add(
                documents=[c["text"] for c in chunks],
                metadatas=[c["metadata"] for c in chunks],
                ids=[c["id"] for c in chunks]
            )

        return {"text": full_text.strip(), "chunks_indexed": len(chunks)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF Parsing error: {str(e)}")

@app.get("/scrape-kanoon")
def scrape_kanoon(judge_name: str):
    try:
        search_query = f"author: {judge_name}"
        search_url = f"https://indiankanoon.org/search/?formInput={search_query}"
        headers = {"User-Agent": "Mozilla/5.0"}
        
        response = requests.get(search_url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        results = soup.find_all('div', class_='result_title')
        
        scraped_text = ""
        count = 0
        
        for result in results:
            if count >= 3:
                break
            link = result.find('a')
            if link:
                doc_id = link.get('href')
                doc_url = f"https://indiankanoon.org{doc_id}"
                doc_resp = requests.get(doc_url, headers=headers, timeout=10)
                if doc_resp.ok:
                    doc_soup = BeautifulSoup(doc_resp.text, 'html.parser')
                    judgement_body = doc_soup.find('div', class_='judgments')
                    if judgement_body:
                        text_content = judgement_body.get_text(separator=' ', strip=True)[:4000]
                        scraped_text += f"\n--- Judgment {count+1} ---\n{text_content}...\n"
                        count += 1
                        
        if not scraped_text:
            return {"judge": judge_name, "scraped_text": "Insufficient evidence found in recent rulings."}
            
        return {"judge": judge_name, "scraped_text": scraped_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ask-question")
async def ask_question(question: str = Form(...), session_id: str = Form(None)):
    try:
        # Semantic search against the vector store
        query_params = {
            "query_texts": [question],
            "n_results": 4
        }
        if session_id:
            query_params["where"] = {"session_id": session_id}
            
        results = collection.query(**query_params)
        
        context = ""
        if results['documents'] and len(results['documents'][0]) > 0:
            for i, doc in enumerate(results['documents'][0]):
                meta = results['metadatas'][0][i]
                context += f"[Page {meta.get('page')}] {doc}\n\n"
        else:
            context = "No relevant documents found in the Vector Database."
            
        return {"context_retrieved": context}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG Retrieval error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
