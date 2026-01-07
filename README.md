# Crazy 8s - Multiplayer Card Game

A modern, web-based implementation of the classic card game **Crazy 8s**, featuring both single-player (vs AI) and real-time multiplayer modes.

![Crazy 8s Game](game_screenshot.png) *(Note: Add a screenshot here if available)*

## 🎮 Features

*   **Two Game Modes:**
    *   **vs Computer:** Play locally against smart AI bots.
    *   **Online Multiplayer:** Create private rooms and invite friends to play in real-time.
*   **Special Cards:**
    *   **8 (Crazy 8):** Wild card - change the active suit.
    *   **2 (Draw Two):** Next player draws 2 cards. Can be stacked!
    *   **7 (Jump):** Skips the next player's turn.
    *   **J (Reverse):** Reverses the direction of play.
*   **Responsive Design:** Works smoothly on desktop and mobile devices.
*   **Real-Time Interactions:** Powered by WebSockets (Socket.io) for instant updates.

## 🚀 How to Play

1.  **Objective:** Be the first player to get rid of all your cards.
2.  **Turn:** Play a card that matches the **Rank** or **Suit** of the top card on the discard pile.
3.  **Drawing:** If you have no matching cards, you must draw from the deck until you find one.
4.  **Winning:** The game ends immediately when a player empties their hand.

## 🛠️ Local Setup

To run the game locally on your machine:

1.  **Prerequisites:** Ensure you have [Node.js](https://nodejs.org/) installed.
2.  **Clone/Download:** Download this repository.
3.  **Install Dependencies:**
    ```bash
    npm install
    ```
4.  **Start the Server:**
    ```bash
    npm start
    ```
5.  **Play:** Open your browser and navigate to `http://localhost:3000`.

## 🌐 Deployment (Render)

This project is ready to be deployed on **Render** or any Node.js hosting platform.

1.  Push this code to a **GitHub** repository.
2.  Create a new **Web Service** on Render.
3.  Connect your repository.
4.  Use the following settings:
    *   **Runtime:** Node
    *   **Build Command:** `npm install`
    *   **Start Command:** `npm start`
5.  Deploy and share your link!

## 💻 Tech Stack

*   **Frontend:** HTML5, CSS3 (Custom Variables & Animations), Vanilla JavaScript
*   **Backend:** Node.js, Express.js
*   **Real-Time Communication:** Socket.io

## 📄 License

This project is open-source and available for personal and educational use.
