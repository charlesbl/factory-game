import React from 'react';
import './css/App.css';
import Game from './Game/Game'
import GameView from './Views/GameView'

const REFRESH_RATE = 50;
const TICK_BEETWEEN_SAVE = 20;
const STORAGE_NAME = 'game';

class App extends React.Component {
    constructor() {
        super();

        var game = this.loadGame();
        if (game === null) {
            game = new Game();
        }

        this.state = {
            game: game
        };
    }

    componentDidMount() {
        setTimeout(() => this.gameLoop());
    }

    componentWillUnmount() {
        this.stop = true;
    }

    async gameLoop() {
        var tickCount = 0;
        while (!this.stop) {
            var startTime = Date.now();
            this.tick();
            tickCount++;
            if (tickCount >= TICK_BEETWEEN_SAVE) {
                tickCount = 0;
                this.saveGame();
            }
            var tickTime = Date.now() - startTime;
            if (tickTime <= REFRESH_RATE)
                await sleep(REFRESH_RATE - tickTime);
        }
    }

    tick() {
        this.state.game.update();
        this.setState({
            game: this.state.game
        });
    }

    saveGame() {
        var save = this.state.game.getSave();
        localStorage.setItem(STORAGE_NAME, JSON.stringify(save));
    }

    loadGame() {
        var save = JSON.parse(localStorage.getItem(STORAGE_NAME));
        if (save === null)
            return null
        return new Game(save);
    }

    clearGame() {
        localStorage.clear(STORAGE_NAME);
        this.setState({
            game: new Game()
        });
    }

    render() {
        return (
            <div className="container-fluid">
                <button className="btn btn-primary" onClick={() => this.clearGame()}>Clear save</button>
                <GameView game={this.state.game} />
            </div>
        );
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export default App;
