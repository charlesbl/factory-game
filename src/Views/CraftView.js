import React from 'react';
import '../css/CraftView.css'

class CraftView extends React.Component {

    renderInput(itemStack) {
        var count = this.props.inventory.count(itemStack.item);
        var capedCount = count > itemStack.quantity ? itemStack.quantity : count;
        var content = itemStack.item.name;
        if (!itemStack.item.infinite) {
            content = capedCount + "/" + itemStack.quantity + " " + content;
        }
        return (
            <div key={itemStack.id} className="input">
                {content}
            </div>
        );
    }

    renderOutput(itemStack) {
        return (
            <div key={itemStack.id} className="output">
                {itemStack.quantity} {itemStack.item.name}
            </div>
        );
    }
    render() {
        var input = this.props.craft.input;
        var output = this.props.craft.output;
        return (
            <div className="craft">
                <div className="craft-grid">
                    <div className="separator">=></div>
                    {input.map((itemStack => this.renderInput(itemStack)))}
                    {output.map((itemStack => this.renderOutput(itemStack)))}
                </div>
            </div>
        );
    }
}
export default CraftView;