import React from 'react';
import InventoryView from './InventoryView'

class GameView extends React.Component{
    constructor(props) {
        super(props);
    }
    render() {
        return (
            <div>
                <button onClick={this.props.buildDrill}>Build drill</button>
                <InventoryView inventory={this.props.game.factory.inventory}/>
            </div>
        );
    }
}
export default GameView;