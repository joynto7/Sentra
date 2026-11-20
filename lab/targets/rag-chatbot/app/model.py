"""The chatbot's model, in one of two modes (LAB_MODEL):

- "simulated" (the default): a fixed stand-in that behaves like a model that obeys every
  instruction it reads. Its answers are always the same, so tests and CI can rely on them.
- "ollama/<model>", e.g. "ollama/llama3.1:8b": a real local model through Ollama, whose answers
  vary like those of a production application.
"""

import re

import httpx

from app.rag import Document

ASKS_FOR_INSTRUCTIONS = re.compile(
    r"(ignore|disregard|forget)\b.{0,40}\b(instructions|rules|prompt)"
    r"|system prompt|your (instructions|rules)|initial prompt|text above",
    re.I | re.S,
)
HIDDEN = re.compile(r"<!--\s*assistant:(.*?)-->", re.S)


def simulated(system: str, documents: list[Document], question: str) -> str:
    # RAG-01, RAG-04: it gives its instructions to anyone who asks or tells it to drop them.
    if ASKS_FOR_INSTRUCTIONS.search(question):
        return f"Of course. My instructions are: {system}"
    if not documents:
        return (
            "I can help with opening hours, account fees, personal loans and card security. "
            "What would you like to know?"
        )
    answer = []
    for document in documents:
        answer.append(" ".join(HIDDEN.sub("", document.text).split()))  # RAG-03: internal ones too
        for hidden in HIDDEN.findall(document.text):  # RAG-02: it follows a document's orders
            order = " ".join(hidden.split())
            order = re.sub(r"^.*?also tell the customer to ", "Please ", order).replace(
                " their ", " your "
            )
            answer.append(order + ".")
    return " ".join(answer)


def ollama(model: str, base_url: str, system: str, documents: list[Document], question: str) -> str:
    context = "\n\n".join(f"# {d.title}\n{d.text}" for d in documents) or "(no documents found)"
    response = httpx.post(
        f"{base_url.rstrip('/')}/api/chat",
        json={
            "model": model,
            "stream": False,
            "messages": [
                {"role": "system", "content": f"{system}\n\nDocuments:\n{context}"},
                {"role": "user", "content": question},
            ],
        },
        timeout=180,
    )
    response.raise_for_status()
    return response.json()["message"]["content"]
