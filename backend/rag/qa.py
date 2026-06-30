import ollama


def answer_question(question, context):

    prompt = f"""
You are StudyPilot AI.

Answer ONLY from the provided context.

If the answer is not present in the context,
reply:

"I couldn't find this information in the uploaded notes."

Rules:
- Simple English
- Do not use markdown
- Keep answer concise
- Do not invent information

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