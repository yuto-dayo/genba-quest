import { extractClientFromBusinessCard } from "./src/services/BusinessCardOcrService";
import dotenv from "dotenv";
dotenv.config();

async function main() {
    try {
        // dummy 1x1 image
        const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        const res = await extractClientFromBusinessCard(base64, "image/png");
        console.log("Success:", res);
    } catch (e: any) {
        console.error("Error:", e.message);
        if (e.response) {
             console.error(e.response);
        }
    }
}
main();
