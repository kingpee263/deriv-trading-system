import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Settings:
    deriv_app_id: str = os.getenv("DERIV_APP_ID", "1089")
    deriv_api_token: str = os.getenv("DERIV_API_TOKEN", "")
    default_symbol: str = os.getenv("DEFAULT_SYMBOL", "R_100")
    host: str = os.getenv("HOST", "127.0.0.1")
    port: int = int(os.getenv("PORT", "8000"))

    @property
    def deriv_ws_url(self) -> str:
        return f"wss://ws.derivws.com/websockets/v3?app_id={self.deriv_app_id}"


settings = Settings()

SUPPORTED_SYMBOLS = [
    {"symbol": "R_10", "name": "Volatility 10 Index", "pip_size": 3},
    {"symbol": "R_25", "name": "Volatility 25 Index", "pip_size": 3},
    {"symbol": "R_50", "name": "Volatility 50 Index", "pip_size": 4},
    {"symbol": "R_75", "name": "Volatility 75 Index", "pip_size": 4},
    {"symbol": "R_100", "name": "Volatility 100 Index", "pip_size": 2},
    {"symbol": "1HZ10V", "name": "Volatility 10 (1s) Index", "pip_size": 2},
    {"symbol": "1HZ25V", "name": "Volatility 25 (1s) Index", "pip_size": 2},
    {"symbol": "1HZ50V", "name": "Volatility 50 (1s) Index", "pip_size": 2},
    {"symbol": "1HZ75V", "name": "Volatility 75 (1s) Index", "pip_size": 2},
    {"symbol": "1HZ100V", "name": "Volatility 100 (1s) Index", "pip_size": 2},
]
