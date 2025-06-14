let pyodide;
let gmpBinding, gmpModule;

const fibInput = document.getElementById("fibInput");
const runAllButton = document.getElementById("runAllButton");
const globalStatus = document.getElementById("globalStatus");
const pyodideStatus = document.getElementById("pyodideStatus");
const pyodideOutput = document.getElementById("pyodideOutput");
const gmpStatus = document.getElementById("gmpStatus");
const gmpOutput = document.getElementById("gmpOutput");

async function initPyodide() {
    pyodideStatus.textContent = "Loading Pyodide...";
    pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/" });
    await pyodide.loadPackage("gmpy2");
    pyodideStatus.textContent = "Pyodide ready!";
}

async function initGMP() {
    gmpStatus.textContent = "Initializing GMP...";
    const { binding, module } = await gmp.init();
    gmpBinding = binding;
    gmpModule = module;
    gmpStatus.textContent = "GMP-Wasm ready!";
}

async function runPurePythonFib(n) {
    purePythonStatus.textContent = "Running Pure Python...";
    purePythonOutput.textContent = "Running...";
    const code = `# (Public) Returns F(n).
def fibonacci(n):
	if n < 0:
		raise ValueError("Negative arguments not implemented")
	return _fib(n)[0]


# (Private) Returns the tuple (F(n), F(n+1)).
def _fib(n):
	if n == 0:
		return (0, 1)
	else:
		a, b = _fib(n // 2)
		c = a * (b * 2 - a)
		d = a * a + b * b
		if n % 2 == 0:
			return (c, d)
		else:
			return (d, c + d)

str(fibonacci(${n}))
    `;
    try {
        if(n >= 100000) {
            throw new Error("Input too large for pure Python implementation");
        }
    const start = performance.now();
    const result = await pyodide.runPythonAsync(code);
    const duration = (performance.now() - start) / 1000;
    purePythonOutput.textContent = `Result: ${result.slice(0, 50)}...\nDigits: ${result.length}\nTime taken: ${duration.toFixed(6)} s`;
    purePythonStatus.textContent = "Done.";
    } catch (err) {
    purePythonOutput.textContent = `${err}`;
    purePythonStatus.textContent = "Error.";
    }
}


async function runPyodideFib(n) {
    pyodideStatus.textContent = "Running Python...";
    pyodideOutput.textContent = "Running...";
    const code = `
import gmpy2
fib = gmpy2.fib(${n})
str(fib)
    `;
    try {
    const start = performance.now();
    const result = await pyodide.runPythonAsync(code);
    const duration = (performance.now() - start) / 1000;
    pyodideOutput.textContent = `Result: ${result.slice(0, 50)}...\nDigits: ${result.length}\nTime taken: ${duration.toFixed(6)} s`;
    pyodideStatus.textContent = "Done.";
    } catch (err) {
    pyodideOutput.textContent = `Error: ${err}`;
    pyodideStatus.textContent = "Error.";
    }
}

async function runGmpFib(n) {
    gmpStatus.textContent = "Running GMP...";
    gmpOutput.textContent = "Running...";
    const start = performance.now();

    try {
    const { calculate, getContext } = await gmp.init();
    calculate((g) => {
        const ctx = getContext();
        const num = ctx.Integer(1);
        gmpBinding.mpz_fib_ui(num.mpz_t, n);
        const resultStr = num.toString();
        const duration = (performance.now() - start) / 1000;
        gmpOutput.textContent = `Result: ${resultStr.slice(0, 50)}...\nDigits: ${resultStr.length}\nTime taken: ${duration.toFixed(6)} s`;
        gmpStatus.textContent = "Done.";
    });
    } catch (err) {
    gmpOutput.textContent = `Error: ${err}`;
    gmpStatus.textContent = "Error.";
    }
}


/* 
* Fast doubling Fibonacci algorithm (JavaScript)
* by Project Nayuki, 2023. Public domain.
* https://www.nayuki.io/page/fast-fibonacci-algorithms
*/


// (Public) Returns F(n).
async function fibonacciJSOnlyMethod(n) {
    if (n < 0)
        throw RangeError("Negative arguments not implemented");
    return fibJsOnly(n)[0];
}


// (Private) Returns the tuple (F(n), F(n+1)).
function fibJsOnly(n) {
    if (n == 0)
        return [0n, 1n];
    else {
        const [a, b] = fibJsOnly(Math.floor(n / 2));
        const c = a * (b * 2n - a);
        const d = a * a + b * b;
        if (n % 2 == 0)
            return [c, d];
        else
            return [d, c + d];
    }
}

async function runFibonacciJSOnly(n) {
    jsStatus.textContent = "Running JavaScript...";
    jsOutput.textContent = "Running...";
    try {
        const start = performance.now();
        const result = await fibonacciJSOnlyMethod(n);
        const duration = (performance.now() - start) / 1000;
        jsOutput.textContent = `Result: ${result.toString().slice(0, 50)}...\nDigits: ${result.toString().length}\nTime taken: ${duration.toFixed(6)} s`;
        jsStatus.textContent = "Done.";
    } catch (err) {
        jsOutput.textContent = `Error: ${err}`;
        jsStatus.textContent = "Error.";
    }
}


async function runAllFibMethods(n) {
    await runFibonacciJSOnly(n);
    await runPurePythonFib(n);
    await runPyodideFib(n);
    await runGmpFib(n);
}


runAllButton.onclick = async () => {
    const n = parseInt(fibInput.value);
    if (isNaN(n) || n < 0) return alert("Invalid number");
    globalStatus.textContent = `Running F(${n})...`;
    await runAllFibMethods(n);
    globalStatus.textContent = `Done with F(${n})!`;
};

(async function initialize() {
    await Promise.all([initPyodide(), initGMP()]);
    globalStatus.textContent = "Ready.";
    runAllButton.disabled = false;
    runAllButton.textContent = "Run Comparison";
})();