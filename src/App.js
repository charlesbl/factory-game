import React from 'react';
import './css/App.css';
import Game from './Game/Game'
import GameView from './Views/GameView'

const REFRESH_RATE = 50;
const SAVE_RATE = 1000;
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
        this.gameTimerID = setInterval(
            () => this.tick(),
            REFRESH_RATE
        );
        this.saveTimerID = setInterval(
            () => this.saveGame(),
            SAVE_RATE
        );
    }

    componentWillUnmount() {
        clearInterval(this.gameTimerID);
        clearInterval(this.saveTimerID);
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
        )
    }
}
export default App;
