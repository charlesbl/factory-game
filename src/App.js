import React from 'react';
import './App.css';
import Game from './Game/Game'
import GameView from './Views/GameView'

const refreshRate = 50;

class App extends React.Component {
    constructor() {
        super();

        this.state = {
            game: new Game()
        };
    }

    componentDidMount() {
        this.timerID = setInterval(
            () => this.tick(),
            refreshRate
        );
    }

    componentWillUnmount() {
        clearInterval(this.timerID);
    }

    tick() {
        this.state.game.update();
        this.setState({
            game: this.state.game
        });
    }
    
    render() {
        return (
        <div className="App">
            <GameView game={this.state.game} />
        </div>
        )
    }
}
export default App;
