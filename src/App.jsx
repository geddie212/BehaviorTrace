import { useState } from "react";

function App() {
  const [message, setMessage] = useState("");

  async function callBackend() {
    const res = await fetch("/.netlify/functions/hello");
    const data = await res.json();
    setMessage(data.message);
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Netlify React + Node Test</h2>
      <button onClick={callBackend}>Call Backend</button>
      <p>{message}</p>
    </div>
  );
}

export default App;
