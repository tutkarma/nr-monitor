import TelegramBot from 'node-telegram-bot-api';
import { parse } from 'node-html-parser';
import { Cron } from 'croner';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const VK_PAGE_URL = 'https://vk.com/@-60394841-kalendar-vyezdov-2025';
const TRIPS_PER_PAGE = 5;
const numberEmojis = {
  '0': '0️⃣',
  '1': '1️⃣',
  '2': '2️⃣',
  '3': '3️⃣',
  '4': '4️⃣',
  '5': '5️⃣',
  '6': '6️⃣',
  '7': '7️⃣',
  '8': '8️⃣',
  '9': '9️⃣'
};

// Month names mapping
const monthNames = {
  1: 'Январь',
  2: 'Февраль',
  3: 'Март',
  4: 'Апрель',
  5: 'Май',
  6: 'Июнь',
  7: 'Июль',
  8: 'Август',
  9: 'Сентябрь',
  10: 'Октябрь',
  11: 'Ноябрь',
  12: 'Декабрь'
};

function getNumberEmoji(num) {
  // Convert number to string and split into digits
  return num.toString().split('').map(digit => numberEmojis[digit] || digit).join('');
}

function getCurrentMonthNumber() {
  const date = new Date();
  return date.getMonth() + 1; // JavaScript months are 0-based
}

function getMonthNumber(monthName) {
  return Object.entries(monthNames).find(([_, name]) => name === monthName)?.[0] || 0;
}

function getMonthName(monthNumber) {
  return monthNames[monthNumber] || '';
}

function parseTitle(title) {
    const titlePattern = /^(.*?)(?:\s*\((\d+\/\d+\/\d+)\))?\s*$/;
    const match = title.match(titlePattern);

    if (!match) {
        return null;
    }

    if (match) {
        const text = match[1].trim();
        const numbers = match[2] ? match[2] : null;
        return { text, numbers };
    }
    return null;
}


function parseParticipants(participants) {
    const participantsPattern = /\((\d+\/\d+\/\d+)\)/;
    const match = participants.match(participantsPattern);

    if (match) {
        return match[1];
    }
    return null;
}

function parseTitleAndParticipants(title, participants) {
    let titleData = parseTitle(title);

    if (!titleData) {
        console.error(`Title ${title} does not match the expected format.`);
        return null;
    }

    const participantsData = parseParticipants(participants);

    const numbers = participantsData || titleData.numbers
    if (!numbers) {
        console.error(`No participant numbers found for title: "${title}"`);
        return null
    }
    const [current_participants, min_participants, max_participants] = numbers.split("/").map(Number);

    return {
        text: titleData.text,
        current_participants: current_participants,
        min_participants: min_participants,
        max_participants: max_participants,
    };
}

async function parseVKPage() {
  console.log('Starting VK page parsing...');
  try {
    const response = await fetch(VK_PAGE_URL);
    const html = await response.text();
    console.log('Successfully fetched VK page');

    const root = parse(html);
    const tripList = root.querySelectorAll('cite')
    let currentMonth = ''
    const trips = []

    console.log('Parsing trips from HTML...');
    for (const tripMonth of tripList) {
      if (tripMonth.querySelector('a') != null) {

        for (const trip of tripMonth.querySelectorAll('a')) {

          const vk_url = trip.getAttribute("href")
          const title = trip.text
          let participants = ''
          const pattern = /^\s*\(\d+\/\d+\/\d+\)\s*$/;
          if (trip.nextSibling != null && trip.nextSibling.text && pattern.test(trip.nextSibling.text)) {
            participants = trip.nextSibling.text
          }
          let parsedTitle = parseTitleAndParticipants(trip.text, participants)
          if (!parsedTitle && trip.nextSibling != null && trip.nextSibling.text) {
             parsedTitle = parseTitleAndParticipants(trip.text + trip.nextSibling.text, "")
          }

          if (!parsedTitle) {
            continue
          }

          const monthNumber = getMonthNumber(currentMonth);
          if (!monthNumber) {
            continue;
          }

          const parsedTrip = {
            'title': parsedTitle.text,
            'month': monthNumber,
            'current_participants': parsedTitle.current_participants,
            'min_participants': parsedTitle.min_participants,
            'max_participants': parsedTitle.max_participants,
            'vk_url': vk_url,
          }

          trips.push(parsedTrip)
        }
      } else {
        currentMonth = tripMonth.text
      }
    }

    console.log(`Parsed ${trips.length} trips successfully`);
    return trips;
  } catch (error) {
    console.error('Error parsing VK page:', error);
    return null;
  }
}

async function removePastTrips() {
  console.log('Starting removal of past trips...');
  const currentMonthNum = getCurrentMonthNumber();
  
  // Get all trips
  const { data: trips } = await supabase
    .from('trips')
    .select('id, month, title');

  if (!trips) {
    console.log('No trips found to remove');
    return;
  }

  // Filter trips from past months
  const pastTrips = trips.filter(trip => trip.month < currentMonthNum);
  console.log(`Found ${pastTrips.length} past trips to remove`);

  // Remove past trips
  for (const trip of pastTrips) {
    console.log(`Removing trip: ${trip.title} (Month: ${trip.month})`);
    // Delete the trip (this will cascade delete subscriptions due to foreign key constraint)
    await supabase
      .from('trips')
      .delete()
      .eq('id', trip.id);
  }
  console.log('Past trips removal completed');
}

async function updateTripsData() {
  console.log('Starting trips data update at:', new Date().toISOString());
  // First, remove past trips
  await removePastTrips();

  const trips = await parseVKPage();
  if (!trips) {
    console.error('Failed to parse trips data');
    return;
  }
  console.log('ok')

  console.log(`Processing ${trips.length} trips...`);
  let updatedCount = 0;
  let newCount = 0;

  for (const trip of trips) {
    const { data: existingTrip } = await supabase
      .from('trips')
      .select()
      .eq('title', trip.title)
      .single();

    if (existingTrip) {
      if (existingTrip.current_participants !== trip.current_participants) {
        console.log(`Updating participants for trip: ${trip.title}`);
        console.log(`Old: ${existingTrip.current_participants}, New: ${trip.current_participants}`);

        await supabase
          .from('trips')
          .update({
            current_participants: trip.current_participants,
            last_updated: new Date().toISOString()
          })
          .eq('id', existingTrip.id);

        await supabase
          .from('participant_history')
          .insert({
            trip_id: existingTrip.id,
            participants: trip.current_participants
          });

        const { data: subscriptions } = await supabase
          .from('subscriptions')
          .select('chat_id')
          .eq('trip_id', existingTrip.id);

        console.log(`Notifying ${subscriptions?.length || 0} subscribers about the update`);

        for (const sub of subscriptions) {
          await bot.sendMessage(
            sub.chat_id,
            `Update for "${trip.title}": Number of participants changed to ${trip.current_participants}/${trip.min_participants}/${trip.max_participants}`
          );
        }
        updatedCount++;
      }
    } else {
      await supabase
        .from('trips')
        .insert([trip]);
      newCount++;
    }
  }

  console.log(`Update completed at ${new Date().toISOString()}`);
  console.log(`Summary: ${newCount} new trips added, ${updatedCount} trips updated`);
}

async function sendTripsList(chatId, page = 1, messageId = null) {
  console.log(`Sending trips list to chat ${chatId} (page ${page})`);
  const { data: trips } = await supabase
    .from('trips')
    .select()
    .order('month');

  if (!trips?.length) {
    const noTripsMessage = 'No trips found.';
    if (messageId) {
      await bot.editMessageText(noTripsMessage, {
        chat_id: chatId,
        message_id: messageId
      });
    } else {
      await bot.sendMessage(chatId, noTripsMessage);
    }
    return;
  }

  const totalPages = Math.ceil(trips.length / TRIPS_PER_PAGE);
  const startIdx = (page - 1) * TRIPS_PER_PAGE;
  const endIdx = startIdx + TRIPS_PER_PAGE;
  const pageTrips = trips.slice(startIdx, endIdx);

  const message = 
    pageTrips.map((trip, index) => 
      `${getNumberEmoji(startIdx + index + 1)} ${getMonthName(trip.month)} - ${trip.title}\n` +
      `   👥 Participants: ${trip.current_participants}/${trip.min_participants}/${trip.max_participants}`
    ).join('\n\n') +
    `\n\nPage ${page}/${totalPages}`;

  const keyboard = {
    inline_keyboard: [
      [
        ...(page > 1 ? [{
          text: '⬅️ Previous',
          callback_data: `trips_page_${page - 1}`
        }] : []),
        ...(page < totalPages ? [{
          text: 'Next ➡️',
          callback_data: `trips_page_${page + 1}`
        }] : [])
      ]
    ]
  };

  if (messageId) {
    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }
}

async function sendSubscriptionsList(chatId, page = 1, messageId = null) {
  console.log(`Sending subscriptions list to chat ${chatId} (page ${page})`);
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select(`
      *,
      trips (
        id,
        month,
        title,
        current_participants,
        min_participants,
        max_participants
      )
    `)
    .eq('chat_id', chatId)
    .order('created_at');

  if (!subscriptions?.length) {
    const noSubsMessage = 'You have no active subscriptions.';
    if (messageId) {
      await bot.editMessageText(noSubsMessage, {
        chat_id: chatId,
        message_id: messageId
      });
    } else {
      await bot.sendMessage(chatId, noSubsMessage);
    }
    return;
  }

  const totalPages = Math.ceil(subscriptions.length / TRIPS_PER_PAGE);
  const startIdx = (page - 1) * TRIPS_PER_PAGE;
  const endIdx = startIdx + TRIPS_PER_PAGE;
  const pageSubscriptions = subscriptions.slice(startIdx, endIdx);

  const message = 
    '📋 Your subscriptions:\n\n' +
    pageSubscriptions.map((sub, index) => 
      `${getNumberEmoji(startIdx + index + 1)} ${getMonthName(sub.trips.month)} - ${sub.trips.title}\n` +
      `👥 Participants: ${sub.trips.current_participants}/${sub.trips.min_participants}/${sub.trips.max_participants}\n` +
      `To unsubscribe use: /unsubscribe ${getNumberEmoji(startIdx + index + 1)}`
    ).join('\n\n') +
    `\n\nPage ${page}/${totalPages}`;

  const keyboard = {
    inline_keyboard: [
      [
        ...(page > 1 ? [{
          text: '⬅️ Previous',
          callback_data: `subs_page_${page - 1}`
        }] : []),
        ...(page < totalPages ? [{
          text: 'Next ➡️',
          callback_data: `subs_page_${page + 1}`
        }] : [])
      ]
    ]
  };

  if (messageId) {
    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }
}

// Bot commands
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 
    '👋 Welcome! I monitor travel participant changes.\n\n' +
    '📝 Available commands:\n' +
    '🗺️ /trips - List all trips with navigation buttons\n' +
    'ℹ️ /info <trip number> - Get trip details\n' +
    '🔔 /subscribe <trip number> - Subscribe to trip updates\n' +
    '📋 /subscriptions - View your active subscriptions\n' +
    '❌ /unsubscribe <subscription number> - Unsubscribe from updates'
  );
});

bot.onText(/\/trips/, async (msg) => {
  await sendTripsList(msg.chat.id, 1);
});

bot.onText(/\/subscriptions/, async (msg) => {
  await sendSubscriptionsList(msg.chat.id, 1);
});

// Handle callback queries (button clicks)
bot.on('callback_query', async (query) => {
  const tripsMatch = query.data.match(/^trips_page_(\d+)$/);
  const subsMatch = query.data.match(/^subs_page_(\d+)$/);
  
  if (tripsMatch) {
    const page = parseInt(tripsMatch[1]);
    await bot.deleteMessage(query.message.chat.id, query.message.message_id);
    await sendTripsList(query.message.chat.id, page);
  } else if (subsMatch) {
    const page = parseInt(subsMatch[1]);
    await bot.deleteMessage(query.message.chat.id, query.message.message_id);
    await sendSubscriptionsList(query.message.chat.id, page);
  }
  
  await bot.answerCallbackQuery(query.id);
});

bot.onText(/\/info (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const tripIndex = parseInt(match[1]) - 1;

  const { data: trips } = await supabase
    .from('trips')
    .select()
    .order('month');

  if (!trips?.[tripIndex]) {
    await bot.sendMessage(chatId, '❌ Trip not found.');
    return;
  }

  const trip = trips[tripIndex];
  const message = 
    `📅 ${getMonthName(trip.month)} - ${trip.title}\n` +
    `👥 Current participants: ${trip.current_participants}\n` +
    `⬇️ Min participants: ${trip.min_participants}\n` +
    `⬆️ Max participants: ${trip.max_participants}\n` +
    `🕒 Last updated: ${new Date(trip.last_updated).toLocaleString()}\n` +
    `🔗 VK page: ${trip.vk_url}`;

  await bot.sendMessage(chatId, message);
});

bot.onText(/\/subscribe (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const tripIndex = parseInt(match[1]) - 1;

  const { data: trips } = await supabase
    .from('trips')
    .select()
    .order('month');

  if (!trips?.[tripIndex]) {
    await bot.sendMessage(chatId, '❌ Trip not found.');
    return;
  }

  const trip = trips[tripIndex];

  try {
    await supabase
      .from('subscriptions')
      .insert({
        trip_id: trip.id,
        chat_id: chatId
      });

    await bot.sendMessage(
      chatId,
      `✅ You've successfully subscribed to updates for "${trip.title}"`
    );
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      await bot.sendMessage(chatId, '⚠️ You are already subscribed to this trip.');
    } else {
      await bot.sendMessage(chatId, '❌ Error subscribing to trip. Please try again.');
    }
  }
});

bot.onText(/\/unsubscribe (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const subscriptionIndex = parseInt(match[1]) - 1;

  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select(`
      *,
      trips (
        title
      )
    `)
    .eq('chat_id', chatId)
    .order('created_at');

  if (!subscriptions?.[subscriptionIndex]) {
    await bot.sendMessage(chatId, '❌ Subscription not found.');
    return;
  }

  const subscription = subscriptions[subscriptionIndex];

  const { error } = await supabase
    .from('subscriptions')
    .delete()
    .eq('id', subscription.id);

  if (error) {
    await bot.sendMessage(chatId, '❌ Error unsubscribing. Please try again.');
    return;
  }

  await bot.sendMessage(
    chatId,
    `✅ You've successfully unsubscribed from updates for "${subscription.trips.title}"`
  );
});

// Schedule updates every hour using Croner
const updateJob = new Cron('0 * * * *', { timezone: "Europe/Moscow" }, () => {
 updateTripsData().catch(error => {
   console.error('Error in scheduled update:', error);
 });
});

// Initial update
updateTripsData();

console.log('Bot is running...');