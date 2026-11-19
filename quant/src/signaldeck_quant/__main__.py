import os

import uvicorn


def main():
    uvicorn.run("signaldeck_quant.api:create_app", factory=True,
                host=os.environ.get("QUANT_HOST", "127.0.0.1"),
                port=int(os.environ.get("QUANT_PORT", "8010")))


if __name__ == "__main__":
    main()
