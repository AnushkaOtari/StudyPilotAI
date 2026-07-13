import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GOOGLE_API_KEY")
)

models_to_test = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-pro-latest",
]

for model in models_to_test:
    try:
        print(f"\nTesting {model}...")
        response = client.models.generate_content(
            model=model,
            contents="Say Hello"
        )
        print("✅ SUCCESS")
        print(response.text)
        break

    except Exception as e:
        print("❌ FAILED")
        print(e)