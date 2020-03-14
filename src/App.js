import React from 'react';
import './App.css';
import Game from './Game/Game'
import GameView from './Views/GameView'

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
            50
        );
    }

    componentWillUnmount() {
        clearInterval(this.timerID);
    }

    tick() {
        this.setState({
            game: this.state.game
        });
    }
    
    render() {
        return (
        <div className="App">
            <GameView 
                game={this.state.game} 
                buildDrill={() => this.state.game.factory.buildDrill()}
            />
        </div>
        )
    }
}
export default App;
