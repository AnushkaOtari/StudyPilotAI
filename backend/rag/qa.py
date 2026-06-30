import ollama


def answer_question(question, context):

    prompt = f"""
You are StudyPilot AI.

Answer ONLY using the provided context.

Rules:
- Answer only from the context.
- If the answer is not present, say:
  "I couldn't find this information in the uploaded notes."
- Use simple English.
- Keep the answer concise.
- Do not use markdown.
- Do not invent information.

Context:
{context}

Question:
{question}

Answer:
"""

    response = ollama.chat(
        model="llama3.2",
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ]
    )

    return response["message"]["content"]