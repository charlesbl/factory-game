import React from 'react';
import './css/App.css';
import Game from './Game/Game'
import GameView from './Views/GameView'

const REFRESH_RATE: number = 50;
const TICK_BETWEEN_SAVE: number = 20;
const STORAGE_NAME: string = 'game';

interface IAppState {
    game: Game;
}

export default class App extends React.Component<any, IAppState> {
    private stop: boolean;

    constructor(props: any) {
        super(props);
        this.stop = false;
        this.state = {
            game: this.loadGame()
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
            if (tickCount >= TICK_BETWEEN_SAVE) {
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

    loadGame(): Game {
        var stringSave = localStorage.getItem(STORAGE_NAME);
        if (stringSave !== null && stringSave !== "") {
            var save = JSON.parse(stringSave);
            return Game.fromSave(save);
        } else {
            return new Game();
        }
    }

    clearGame() {
        localStorage.setItem(STORAGE_NAME, "");
        window.location.reload();
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

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}