import Resolver from '@forge/resolver';
import api from '@forge/api';
import { RRule } from 'rrule';

const resolver = new Resolver();

// Constants
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

// Calendar configurations
const CALENDAR_CONFIGS = [
  {
    name: 'Events',
    url: '/owa/calendar/9ff3ce41fc174c9bae0ada4b0b00d8f2@aequitas-group.de/152c3088f1714998802b4c9bce0055a816003284176658262502/calendar.ics',
  },
  {
    name: 'Practices',
    url: '/owa/calendar/791ff38cbb424ab2b8d57db1527b6cea@aequitas-group.de/d257833e5aae429997b43cbafc1cba5f5215817534631150742/calendar.ics',
  },
  {
    name: 'Training',
    url: '/owa/calendar/7845c8c42dae45c9b2d420a75133841b@aequitas-group.de/438ac5667a004f24a6a245e48e28f53810307018438302888922/calendar.ics',
  },
];

// Cache management class
class EventCache {
  constructor() {
    this.data = null;
    this.timestamp = null;
  }

  isValid() {
    if (!this.data || !this.timestamp) {
      return false;
    }
    return (Date.now() - this.timestamp) < CACHE_DURATION;
  }

  set(data) {
    this.data = data;
    this.timestamp = Date.now();
    console.log('Events cached at:', new Date(this.timestamp).toISOString());
  }

  get() {
    return this.data;
  }

  clear() {
    this.data = null;
    this.timestamp = null;
    console.log('Event cache cleared');
  }
}

const eventCache = new EventCache();

// Utility functions
function formatTime(dateString) {
  return `${dateString.slice(9, 11)}:${dateString.slice(11, 13)} Uhr`;
}

function parseICalDate(dateString) {
  return new Date(`${dateString.slice(0, 4)}-${dateString.slice(4, 6)}-${dateString.slice(6, 8)}T${dateString.slice(9, 11)}:${dateString.slice(11, 13)}:${dateString.slice(13, 15)}Z`);
}

function escapeText(text) {
  return text
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\n/g, ' ')
    .replace(/\\\\/g, '\\');
}

function getFutureEvents(events) {
  const today = new Date();
  return events.filter(event => event.start > today);
}

function sortEventsByStartTime(events) {
  return events.sort((a, b) => a.start - b.start);
}

function removeDuplicateEvents(events) {
  const duplicateIndices = new Set();
  
  for (let i = 0; i < events.length; i++) {
    for (let j = 0; j < events.length; j++) {
      if (i !== j && 
          events[i].hasOwnProperty('rrid') && 
          !events[j].hasOwnProperty('rrid') &&
          events[i].title === events[j].title &&
          events[i].rrid.valueOf() === events[j].start.valueOf()) {
        duplicateIndices.add(j);
      }
    }
  }
  
  return events.filter((_, index) => !duplicateIndices.has(index));
}

async function loadIcal(calendar) {
  console.log('Loading iCal:', calendar.url);
  try {
    const response = await api.invokeRemote('office365', {
      path: calendar.url,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT }
    });
    return response.text();
  } catch (error) {
    console.error(`Failed to load iCal from ${calendar.name}:`, error);
    throw error;
  }
}
function parseEvent(lines, startIndex, calendar) {
  const event = { calendar: calendar.name };
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('DTSTART')) {
      event.dtstart = line;
      const dateValue = line.split(':')[1];
      event.start = parseICalDate(dateValue);
      event.starttime = formatTime(dateValue);
      event.startday = event.start.getDate();
      event.startmonth = MONTHS[event.start.getMonth()];
      event.startyear = dateValue.slice(0, 4);
    } 
    else if (line.includes('RRULE')) {
      event.rrule = line;
    } 
    else if (line.includes('RECURRENCE-ID')) {
      const rridValue = line.split(':')[1];
      event.rrid = parseICalDate(rridValue);
    } 
    else if (line.includes('DTEND')) {
      const endDateValue = line.split(':')[1];
      event.endtime = formatTime(endDateValue);
    } 
    else if (line.includes('SUMMARY')) {
      const title = line.slice(8);
      event.title = escapeText(title);
    } 
    else if (line.includes('END:VEVENT')) {
      return { event, nextIndex: i + 1 };
    }
  }
  
  return { event, nextIndex: lines.length };
}

function expandRecurringEvent(event) {
  if (!event.rrule) {
    return [event];
  }
  
  try {
    const options = RRule.parseString(event.rrule);
    options.dtstart = event.start;
    
    if (options.until) {
      options.until.setDate(options.until.getDate() + 1);
    }
    
    const rrule = new RRule(options);
    const dates = rrule.all();
    
    return dates.map(date => ({
      ...event,
      start: date,
      startday: date.getDate(),
      startmonth: MONTHS[date.getMonth()]
    }));
  } catch (error) {
    console.error('Error expanding recurring event:', error);
    return [event];
  }
}

function parseEvents(body, calendar) {
  const events = [];
  const lines = body.split(/\r?\n/);
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('BEGIN:VEVENT')) {
      const { event, nextIndex } = parseEvent(lines, i + 1, calendar);
      const expandedEvents = expandRecurringEvent(event);
      events.push(...expandedEvents);
      i = nextIndex - 1; // -1 because the loop will increment
    }
  }
  
  return events;
}

async function loadAndProcessAllCalendars() {
  console.log('Cache invalid or empty, loading fresh data');
  
  try {
    const loadPromises = CALENDAR_CONFIGS.map(async calendar => {
      const body = await loadIcal(calendar);
      return parseEvents(body, calendar);
    });
    
    const eventsArrays = await Promise.all(loadPromises);
    const allEvents = eventsArrays.flat();
    
    const sortedEvents = sortEventsByStartTime(allEvents);
    const filteredEvents = removeDuplicateEvents(sortedEvents);
    
    eventCache.set(filteredEvents);
    
    return getFutureEvents(filteredEvents);
  } catch (error) {
    console.error('Error loading calendars:', error);
    throw error;
  }
}

// Resolver definitions
resolver.define('getData', async (req) => {
  try {
    let futureEvents;
    
    if (eventCache.isValid()) {
      console.log('Returning cached events');
      futureEvents = getFutureEvents(eventCache.get());
    } else {
      futureEvents = await loadAndProcessAllCalendars();
    }
    
    // Return only the closest 3 upcoming events
    return futureEvents.slice(0, 3);
  } catch (error) {
    console.error('Error in getData:', error);
    throw error;
  }
});

resolver.define('clearCache', (req) => {
  eventCache.clear();
  return Promise.resolve({ success: true, message: 'Cache cleared' });
});

export const handler = resolver.getDefinitions();

