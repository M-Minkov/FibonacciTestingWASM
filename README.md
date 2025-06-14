# FibonacciTestingWASM

This project is a simple web-based tool to compare the performance of different Fibonacci number calculation methods, with a focus on WebAssembly (WASM) and Python in the browser.

## Purpose
The goal is to benchmark and visually compare the speed and capabilities of:
- **Pure JavaScript**
- **Pyodide (Pure Python)** running in WASM
- **Pyodide (Python + gmpy2)** GMP linked to Python, but still python code being interpreted with interpreter overhead
- **GMP-Wasm** (GMP C code directly compiled to WebAssembly)

## How it Works
- Enter a Fibonacci index (N) and click "Run Comparison".
- The app calculates F(N) using each method and displays the result, number of digits, and time taken.
- All calculations are performed in the browser, leveraging WASM.
- Browser will get slow

## Technologies Used
- **JavaScript** for the UI and the baseline algorithm
- **Pyodide** to run Python and gmpy2 in the browser via WASM
- **GMP-Wasm** for high-performance big integer math
- **Web Workers** (not used, but recommended) to keep the UI responsive during heavy calculations

## Why?
WebAssembly enables running high-performance code (like Python or C libraries) in the browser. This project demonstrates the practical performance differences and benefits of using WASM for computationally intensive tasks compared to native JavaScript.

## Usage
1. Open `index.html` in your browser.
2. Wait for all modules to load (button will become enabled).
3. Enter a value for N and click "Run Comparison".
4. View the results and timings for each method.

## Notes
- For very large N, some methods may be much faster or slower than others.
- All computation is client-side;

---

Feel free to use or modify this project for your own WASM or performance testing experiments!

