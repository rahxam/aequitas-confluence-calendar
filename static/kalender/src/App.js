import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import "./css/addon.css";

function App() {


  const [data, setData] = useState(null);

  useEffect(() => {
    invoke('getData', { example: 'getData' }).then(setData);
  }, []);

  return !data ? <div>Loading...</div> : (
    <div>
      <div className="middle">
        <div className="timeline">
          <ul className="">
            {data.map((event, index) => (
              <li key={index} style={{ minHeight: '60px', display: 'block', marginBottom: '10px' }}>
                <div className="hour">
                  <span>{event.startday}</span>
                  <span id="sub">{event.startmonth}</span>
                  <span id="sub">{event.startyear}</span>
                </div>
                <div className="work">
                  <span>{event.title}</span><br />
                  <span id="sub">{event.calendar}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default App;
